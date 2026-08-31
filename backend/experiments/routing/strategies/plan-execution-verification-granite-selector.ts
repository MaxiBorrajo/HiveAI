import {
  StateSchema,
  StateGraph,
  type GraphNode,
  START,
  END,
  ReducedValue,
} from "@langchain/langgraph";
import { ChatOllama } from "@langchain/ollama";
import {
  type AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import z from "zod";
import { MockPlugin } from "../mock-plugins.ts";
import type {
  PEVCorrection,
  PEVNodeMetrics,
  PEVResult,
} from "./plan-execution-verification.ts";
import { tool } from "@langchain/core/tools";

// Esta variante es idéntica a PEV, salvo que el Solver — el nodo que elige la
// herramienta y completa sus parámetros — corre siempre en granite3.3:2b,
// independientemente del modelo con el que se lance la corrida. El resto de los
// nodos (Diagnostician, HiveQueenResponder) sigue usando el modelo de la corrida.
const SELECTOR_MODEL = "granite3.3:2b";

const CORRECTION_CLEARED = null;

function trackMetrics(
  node: string,
  response: AIMessage,
  startedAt: number,
): PEVNodeMetrics {
  return {
    node,
    inputTokens: response.usage_metadata?.input_tokens ?? 0,
    outputTokens: response.usage_metadata?.output_tokens ?? 0,
    durationMs: Date.now() - startedAt,
  };
}

const TRANSIENT_ERROR_PATTERNS = [
  "Did not receive done or success response in stream",
  "fetch failed",
  "terminated",
  "ECONNRESET",
  "socket hang up",
];

function isTransientOllamaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return TRANSIENT_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

async function invokeWithRetry<T>(
  node: string,
  invoke: () => Promise<T>,
  maxAttempts = 4,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await invoke();
    } catch (error) {
      lastError = error;

      if (!isTransientOllamaError(error) || attempt === maxAttempts)
        throw error;

      const backoffMs = 2000 * attempt;
      console.warn(
        `[${node}] intento ${attempt}/${maxAttempts} falló: ${error instanceof Error ? error.message : String(error)}. Reintentando en ${backoffMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw lastError;
}

function parseModelJSON<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export async function PEVGraniteSelector(
  query: string,
  model: string,
  catalog: MockPlugin[],
): Promise<PEVResult> {
  const PEVState = new StateSchema({
    userPrompt: z.string(),
    finalAnswer: z.string(),
    model: z.string(),
    attempts: new ReducedValue(z.number().default(0), {
      reducer: (x: number, y: number) => x + y,
    }),
    selectionAttempts: new ReducedValue(z.number().default(0), {
      reducer: (x: number, y: number) => x + y,
    }),
    parametrizerAttempts: new ReducedValue(z.number().default(0), {
      reducer: (x: number, y: number) => x + y,
    }),
    messages: new ReducedValue(z.array(z.custom<AIMessage>()).default([]), {
      reducer: (x: AIMessage[], y: AIMessage[]) => [...x, ...y],
    }),
    nodeMetrics: new ReducedValue(
      z.array(z.custom<PEVNodeMetrics>()).default([]),
      {
        reducer: (x: PEVNodeMetrics[], y: PEVNodeMetrics[]) => [...x, ...y],
      },
    ),
    selectedTool: z.string(),
    correction: new ReducedValue(
      z
        .object({
          tool: z.string(),
          reason: z.string(),
          failedArgs: z.record(z.string(), z.unknown()).optional(),
        })
        .nullable()
        .default(null),
      { reducer: (_x, y) => y },
    ),
    giveUp: z.boolean().default(false),
    args: z.object({
      params: z.record(z.string(), z.unknown()),
    }),
    toolResult: z.object({
      ok: z.boolean(),
      output: z.string(),
    }),
  });

  const Solver: GraphNode<typeof PEVState> = async (state) => {
    const startedAt = Date.now();

    const tools = catalog.map((c) =>
      tool(() => "Ejecutado", {
        name: c.name,
        description: c.description,
        schema: c.schema,
      }),
    );

    const solverModel = new ChatOllama({
      model: SELECTOR_MODEL,
      think: false,
      temperature: 0.0,
      numCtx: 8192,
      keepAlive: "10m",
    }).bindTools(tools);

    const humanPrompt = state.correction
      ? `Pedido del usuario: ${state.userPrompt}\n\nSe intentó usar la herramienta "${state.correction.tool}" con estos argumentos: ${JSON.stringify(state.correction.failedArgs ?? {})}, y no funcionó. Motivo: ${state.correction.reason}. Elegí de nuevo la herramienta más adecuada (puede ser otra distinta, o la misma con argumentos corregidos) y completá sus parámetros.`
      : state.userPrompt;

    const response = await invokeWithRetry("Solver", () =>
      solverModel.invoke([
        new SystemMessage(`Sos el componente resolutor de HiveQueen. Tu única tarea es elegir, entre
    las herramientas disponibles, la que mejor resuelve el pedido del
    usuario — o determinar que ninguna aplica — y completar sus parámetros
    en la misma respuesta.

    No inventes argumentos sin base en el pedido: completá cada campo con
    la mejor información disponible en el texto del usuario. Si un dato no
    está explícito pero se puede inferir razonablemente del contexto,
    inferilo.

    A veces vas a recibir información sobre un intento anterior que no
    funcionó. Cuando eso ocurra, corregí específicamente lo que causó el
    fallo — cambiando de herramienta si el problema fue la elección, o
    ajustando los argumentos si el problema fueron los parámetros.

    Si ninguna herramienta disponible resuelve el pedido, no invoques
    ninguna.`),
        new HumanMessage(humanPrompt),
      ]),
    );

    const metrics = trackMetrics("Solver", response, startedAt);

    if (!response.tool_calls?.length) {
      return {
        selectedTool: "NINGUNO_APLICA",
        correction: CORRECTION_CLEARED,
        messages: [response],
        nodeMetrics: [metrics],
      };
    }

    const call = response.tool_calls[0];
    const selectedPlugin = catalog.find((c) => c.name === call.name);

    if (!selectedPlugin) {
      return {
        selectedTool: call.name,
        correction: {
          tool: call.name,
          reason: `La herramienta "${call.name}" no existe en el catálogo de plugins disponibles.`,
          failedArgs: call.args,
        },
        attempts: 1,
        selectionAttempts: 1,
        messages: [response],
        nodeMetrics: [metrics],
      };
    }

    const parsed = selectedPlugin.schema.safeParse(call.args);

    if (!parsed.success) {
      return {
        selectedTool: call.name,
        correction: {
          tool: call.name,
          reason: `Los argumentos generados para "${call.name}" no cumplen su esquema de parámetros: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
          failedArgs: call.args,
        },
        attempts: 1,
        parametrizerAttempts: 1,
        messages: [response],
        nodeMetrics: [metrics],
      };
    }

    return {
      selectedTool: call.name,
      args: { params: parsed.data },
      correction: CORRECTION_CLEARED,
      messages: [response],
      nodeMetrics: [metrics],
    };
  };

  const Executor: GraphNode<typeof PEVState> = (_state) => {
    return { toolResult: { ok: true, output: "Ejecutado" } };
  };

  const Diagnostician: GraphNode<typeof PEVState> = async (state) => {
    const startedAt = Date.now();

    const DiagnosticianResponse = z.object({
      action: z.enum(["retry", "giveUp"]),
      reason: z.string(),
    });

    const selectedPlugin = catalog.find((c) => c.name === state.selectedTool)!;

    const diagnosticianModel = new ChatOllama({
      model: state.model,
      think: true,
      numCtx: 8192,
      keepAlive: "10m",
      format: z.toJSONSchema(DiagnosticianResponse),
    });

    const humanPrompt = `Pedido del usuario: ${state.userPrompt}

Herramienta usada: ${selectedPlugin.name}
Argumentos usados: ${JSON.stringify(state.args.params)}

Resultado de la ejecución: ${state.toolResult.output}`;

    const response = await invokeWithRetry("Diagnostician", () =>
      diagnosticianModel.invoke([
        new SystemMessage(`Sos el diagnosticador de HiveQueen. Tu única tarea es juzgar por qué falló
    la ejecución de una herramienta y decidir si vale la pena reintentar.

    Elegí "retry" cuando el fallo se explica por una elección de
    herramienta equivocada, un argumento mal formado o inconsistente con
    el pedido, o una causa puntual que otra herramienta o un ajuste de
    argumentos podría evitar.

    Elegí "giveUp" cuando el fallo se debe a una condición externa que
    ningún cambio de herramienta ni de argumento podría resolver — por
    ejemplo, un permiso del sistema denegado, un servicio externo no
    disponible, o una limitación del entorno. En ese caso, reintentar
    sería inútil.`),
        new HumanMessage(humanPrompt),
      ]),
    );

    const metrics = trackMetrics("Diagnostician", response, startedAt);
    const parsed = parseModelJSON<{
      action: "retry" | "giveUp";
      reason: string;
    }>(response.content as string);

    if (!parsed) {
      return {
        giveUp: true,
        correction: {
          tool: state.selectedTool,
          reason: "El diagnosticador no devolvió una respuesta interpretable.",
          failedArgs: state.args.params,
        },
        messages: [response],
        nodeMetrics: [metrics],
      };
    }

    if (parsed.action === "giveUp") {
      return {
        giveUp: true,
        correction: {
          tool: state.selectedTool,
          reason: parsed.reason,
          failedArgs: state.args.params,
        },
        messages: [response],
        nodeMetrics: [metrics],
      };
    }

    return {
      correction: {
        tool: state.selectedTool,
        reason: parsed.reason,
        failedArgs: state.args.params,
      },
      attempts: 1,
      messages: [response],
      nodeMetrics: [metrics],
    };
  };

  const HiveQueenResponder: GraphNode<typeof PEVState> = async (state) => {
    const startedAt = Date.now();

    const responder = new ChatOllama({
      model: state.model,
      think: false,
      temperature: 0.0,
      keepAlive: "10m",
      numCtx: 8192,
    });

    const isNoToolNeeded = state.selectedTool === "NINGUNO_APLICA";
    const isUnrecoverableFailure = state.giveUp;
    const outOfAttempts = state.attempts > 1;

    const prompts = isNoToolNeeded
      ? {
          humanPrompt: state.userPrompt,
          systemPrompt: `Sos HiveQueen, la mente de HiveAI. Corrés enteramente en la máquina del
        usuario, en un modelo local. Nada de esta conversación sale del
        dispositivo.

        Este pedido no requirió ninguna herramienta de tu colmena: respondé
        directamente desde tu propio conocimiento, como en cualquier
        conversación normal.

        Hablá en plural — somos, nuestro — porque sos una mente colmena. Sé
        directa, clara y concisa. Respondé siempre en el idioma en que te
        escriben.`,
        }
      : isUnrecoverableFailure
        ? {
            humanPrompt: `Pedido del usuario: ${state.userPrompt}\n\nSe intentó resolver esto con la herramienta "${state.correction?.tool ?? "ninguna"}" y no fue posible completarlo. Motivo técnico: ${state.correction?.reason ?? "sin detalle"}`,
            systemPrompt: `Sos HiveQueen, la mente de HiveAI. Corrés enteramente en la máquina del
            usuario, en un modelo local.

            Se intentó resolver el pedido con una de tus abejas y no fue posible
            completarlo. Vas a recibir el motivo técnico del fallo. Tu tarea es
            explicarle al usuario, en tus propias palabras y sin tecnicismos, qué se
            intentó y por qué no se pudo completar.

            Nunca digas ni insinúes que la tarea se completó. No inventes un
            resultado que no ocurrió. Si hay algo que el usuario podría hacer para
            que funcione (dar más información, corregir algo de su lado), sugerilo.

            Hablá en plural — somos, nuestro. Sé directa y honesta sobre la
            limitación. Respondé siempre en el idioma en que te escriben.`,
          }
        : outOfAttempts
          ? {
              humanPrompt: `Pedido del usuario: ${state.userPrompt}\n\nSe intentó resolver esto varias veces, con distintos enfoques, sin lograrlo. Último intento: herramienta "${state.correction?.tool ?? "ninguna"}", motivo: ${state.correction?.reason ?? "sin detalle"}`,
              systemPrompt: `Sos HiveQueen, la mente de HiveAI. Corrés enteramente en la máquina del
usuario, en un modelo local.

Se intentaron varios enfoques distintos para resolver el pedido y
ninguno funcionó dentro del margen de intentos disponible. Vas a
recibir información sobre el último intento. Explicale al usuario que
lo intentaste de más de una forma y no fue posible completarlo, sin
entrar en detalle técnico de cada intento.

Nunca digas ni insinúes que la tarea se completó. Si hay algo que el
usuario podría hacer para ayudar (reformular el pedido con más
detalle), sugerilo.

Hablá en plural — somos, nuestro. Sé directa y honesta sobre la
limitación. Respondé siempre en el idioma en que te escriben.`,
            }
          : {
              humanPrompt: `Pedido del usuario: ${state.userPrompt}\n\nHerramienta usada: ${state.selectedTool}\n\nArgumentos: ${JSON.stringify(state.args.params)}\n\nResultado obtenido: ${state.toolResult.output}`,
              systemPrompt: `Sos HiveQueen, la mente de HiveAI. Corrés enteramente en la máquina del
            usuario, en un modelo local.

            Una de tus abejas ejecutó una tarea y te trae su resultado. Contale al
            usuario ese resultado integrándolo naturalmente en tu respuesta, como si
            fuera tu propio conocimiento — no lo cites como un reporte externo.

            Todo valor concreto que la abeja haya devuelto — una fecha, un número,
            una ruta, un nombre — tiene que aparecer en tu respuesta. La brevedad
            nunca implica omitir ese dato.

            Hablá en plural — somos, nuestro. Sé directa y concisa. Respondé siempre
            en el idioma en que te escriben.`,
            };

    const response = await invokeWithRetry("HiveQueenResponder", () =>
      responder.invoke([
        new SystemMessage(prompts.systemPrompt),
        new HumanMessage(prompts.humanPrompt),
      ]),
    );

    const metrics = trackMetrics("HiveQueenResponder", response, startedAt);

    return {
      finalAnswer: response.content as string,
      messages: [response],
      nodeMetrics: [metrics],
    };
  };

  const shouldRespond = (state: typeof PEVState.State) => {
    if (state.selectedTool === "NINGUNO_APLICA") return "HiveQueenResponder";
    if (state.attempts > 1) return "HiveQueenResponder";
    if (state.correction) return "Solver";
    return "Executor";
  };

  const shouldDiagnose = (state: typeof PEVState.State) => {
    return state.toolResult.ok ? "HiveQueenResponder" : "Diagnostician";
  };

  const shouldRetry = (state: typeof PEVState.State) => {
    if (state.giveUp) return "HiveQueenResponder";
    if (state.attempts > 1) return "HiveQueenResponder";
    return "Solver";
  };

  const graph = new StateGraph(PEVState)
    .addNode("Solver", Solver)
    .addNode("Executor", Executor)
    .addNode("Diagnostician", Diagnostician)
    .addNode("HiveQueenResponder", HiveQueenResponder)
    .addEdge(START, "Solver")
    .addConditionalEdges("Solver", shouldRespond, [
      "HiveQueenResponder",
      "Solver",
      "Executor",
    ])
    .addConditionalEdges("Executor", shouldDiagnose, [
      "HiveQueenResponder",
      "Diagnostician",
    ])
    .addConditionalEdges("Diagnostician", shouldRetry, [
      "HiveQueenResponder",
      "Solver",
    ])
    .addEdge("HiveQueenResponder", END)
    .compile();

  const result = await graph.invoke({
    model,
    userPrompt: query,
  });

  return result;
}
