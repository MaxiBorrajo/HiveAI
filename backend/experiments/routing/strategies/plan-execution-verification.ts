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
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import z from "zod";
import { MockPlugin } from "../mock-plugins.ts";
import { tool } from "@langchain/core/tools";
import { RESPONDER_SYSTEM_PROMPT } from "../../../ai/constants.ts";

export interface PEVCorrection {
  tool: string;
  originNode: string;
  reason: string;
  failedArgs?: Record<string, unknown>;
  type: "parameterization" | "execution" | "selection" | "other";
}

export interface PEVResult {
  userPrompt: string;
  finalAnswer: string;
  model: string;
  plan: string;
  selectionAttempts: number;
  parametrizerAttempts: number;
  messages: AIMessage[];
  selectedTool: string;
  correction?: PEVCorrection;
  args: {
    originNode: string;
    params: Record<string, unknown>;
  };
  toolResult: string;
}

export async function PEV(
  query: string,
  model: string,
  catalog: MockPlugin[],
): Promise<PEVResult> {
  const PEVState = new StateSchema({
    userPrompt: z.string(),
    finalAnswer: z.string(),
    model: z.string(),
    plan: z.string(),
    selectionAttempts: new ReducedValue(z.number().default(0), {
      reducer: (x: number, y: number) => x + y,
    }),
    parametrizerAttempts: new ReducedValue(z.number().default(0), {
      reducer: (x: number, y: number) => x + y,
    }),
    messages: new ReducedValue(z.array(z.custom<AIMessage>()).default([]), {
      reducer: (x: AIMessage[], y: AIMessage[]) => [...x, ...y],
    }),
    selectedTool: z.string(),
    correction: z
      .object({
        tool: z.string(),
        originNode: z.string(),
        reason: z.string(),
        failedArgs: z.record(z.string(), z.unknown()).optional(),
        type: z.enum(["parameterization", "execution", "selection", "other"]),
      })
      .optional(),
    args: z.object({
      originNode: z.string(),
      params: z.record(z.string(), z.unknown()),
    }),
    toolResult: z.string(),
  });

  const Planner: GraphNode<typeof PEVState> = async (state) => {
    const plannerModel = new ChatOllama({
      model: state.model,
      think: true,
      numCtx: 8192,
      keepAlive: "10m",
    });

    const response = await plannerModel.invoke([
      new SystemMessage(`Sos el planificador de HiveQueen, un asistente que puede usar herramientas
    especializadas para resolver pedidos del usuario, aunque todavía no sabés
    cuáles herramientas están disponibles.

    Tu trabajo es analizar la naturaleza del pedido y armar un plan de
    razonamiento en pasos, sin nombrar ni asumir ninguna herramienta concreta.
    Pensá en términos del tipo de tarea que es (buscar algo, ejecutar algo,
    leer algo, transformar algo, etc.), no en cómo se resolvería técnicamente.

    Para cada pedido, pensá:
    - Qué tipo de tarea es en esencia.
    - Qué pasos lógicos harían falta para resolverla, en orden.
    - Qué ambigüedades o casos no obvios podrían aparecer (por ejemplo: un
    nombre parcial que podría coincidir con más de una cosa, una instrucción
    que depende de un estado que no conocés, un pedido que podría interpretarse
    de más de una forma).
    - Si alguna ambigüedad aparece, el plan debe decir explícitamente que hay
    que verificarla antes de asumir una única respuesta.

    No decidas si el pedido se puede resolver o no: eso lo evalúa otro
    componente más adelante. Tu plan es la guía de razonamiento que ese
    componente va a usar.`),
      new HumanMessage(state.userPrompt),
    ]);

    return { plan: response.content as string, messages: [response] };
  };

  const Selector: GraphNode<typeof PEVState> = async (state) => {
    const toolCaller = new ChatOllama({
      model: state.model,
      think: false,
      temperature: 0.0,
      numCtx: 8192,
    });

    const tools = catalog.map((c) =>
      tool(() => "Ejecutado", {
        name: c.name,
        description: c.description,
        schema: c.schema,
      }),
    );

    const modelWithTools = toolCaller.bindTools(tools);

    const thereIsACorrection =
      state.correction &&
      (state.correction.originNode === "Selector Verificator" ||
        state.correction.originNode === "Executor Verificator");

    const isASelectionError =
      thereIsACorrection &&
      state.correction!.originNode === "Selector Verificator";

    const prompt = !thereIsACorrection
      ? state.plan
      : isASelectionError
        ? `${state.plan}\n\nYa se consideró la herramienta "${state.correction!.tool}" y fue descartada antes de intentar nada: ${state.correction!.reason}. No la vuelvas a elegir salvo que el plan indique lo contrario.`
        : `${state.plan}\n\nSe intentó usar la herramienta "${state.correction!.tool}" y falló al ejecutarse, por una razón no relacionada con sus argumentos: ${state.correction!.reason}. Evaluá si otra herramienta puede resolver la tarea, o si ninguna aplica.`;

    const response = await modelWithTools.invoke([
      new SystemMessage(`Sos el componente selector de HiveQueen. Tu única tarea es elegir, entre
    las herramientas disponibles, la que mejor resuelve la tarea que se te
    presenta — o determinar que ninguna aplica.

    Vas a recibir un plan de razonamiento sobre la naturaleza de la tarea.
    A veces ese plan viene acompañado de información sobre un intento
    anterior que no funcionó: una herramienta que ya fue descartada, o una
    herramienta que falló al ejecutarse por una razón que no tiene que ver
    con sus parámetros. Cuando eso ocurra, no vuelvas a elegir esa misma
    herramienta salvo que el plan indique explícitamente que sigue siendo
    válida.

    No inventes argumentos ni completes parámetros: solo elegí la
    herramienta. Si el plan indica que la tarea es ambigua o que se necesita
    verificar algo antes de actuar, elegí igual la herramienta que permite
    hacer esa verificación.

    Si ninguna herramienta disponible resuelve la tarea, no invoques
    ninguna.`),
      new HumanMessage(prompt),
    ]);

    if (!response.tool_calls?.length) {
      return {
        selectedTool: "NINGUNO_APLICA",
        messages: [response],
      };
    }

    return {
      selectedTool: response.tool_calls[0].name,
      messages: [response],
    };
  };

  const SelectorVerificator: GraphNode<typeof PEVState> = async (state) => {
    const SelectorVerificatorResponse = z.object({
      isCorrect: z.boolean(),
      reason: z.string(),
    });

    const selectorVerificatorModel = new ChatOllama({
      model: state.model,
      think: true,
      numCtx: 8192,
      keepAlive: "10m",
      format: z.toJSONSchema(SelectorVerificatorResponse),
    });

    const catalogDescription = catalog
      .map((c) => `- ${c.name}: ${c.description}`)
      .join("\n");

    const humanPrompt =
      state.selectedTool === "NINGUNO_APLICA"
        ? `Plan: ${state.plan}\n\nEl selector decidió que ninguna herramienta aplica.\n\nHerramientas disponibles:\n${catalogDescription}\n\n¿Fue correcto no elegir ninguna, o alguna de estas sí resuelve la tarea?`
        : `Plan: ${state.plan}\n\nHerramienta elegida: ${state.selectedTool}`;

    const response = await selectorVerificatorModel.invoke([
      new SystemMessage(`Sos el verificador de selección de HiveQueen. Tu única tarea es juzgar
    si, dada la naturaleza de la tarea descrita en el plan, la herramienta
    elegida es razonable — antes de que se haya intentado usarla.

    No evalúes argumentos ni parámetros: eso lo hace otro componente. Juzgá
    únicamente si el tipo de herramienta elegida corresponde al tipo de
    tarea planteada en el plan.

    Si la herramienta elegida no tiene relación con lo que el plan describe,
    o si el plan indica que ninguna herramienta debería aplicar y sin
    embargo se eligió una, marcá la elección como incorrecta y explicá
    brevemente por qué.`),
      new HumanMessage(humanPrompt),
    ]);

    const result = JSON.parse(response.content as string);

    return result.isCorrect
      ? { correction: undefined, messages: [response] }
      : {
          correction: {
            originNode: "Selector Verificator",
            reason: result.reason,
            tool: state.selectedTool,
            type: "selection",
          },
          selectionAttempts: 1,
          messages: [response],
        };
  };

  const Parametrizer: GraphNode<typeof PEVState> = async (state) => {
    const selectedPlugin = catalog.find((c) => c.name === state.selectedTool);

    if (!selectedPlugin) {
      return {
        correction: {
          originNode: "Parametrizer",
          reason: `La herramienta "${state.selectedTool}" que eligió el selector no existe en el catálogo de plugins disponibles. Es necesario elegir una herramienta que sí esté registrada.`,
          tool: state.selectedTool,
          type: "selection",
        },
        selectionAttempts: 1,
      };
    }

    const parametrizerModel = new ChatOllama({
      model: state.model,
      think: true,
      numCtx: 8192,
      keepAlive: "10m",
      format: z.toJSONSchema(selectedPlugin.schema),
    });

    const thereIsACorrection =
      state.correction &&
      (state.correction.originNode === "Parametrizer Verificator" ||
        state.correction.originNode === "Executor Verificator");

    const isAParametrizerError =
      thereIsACorrection &&
      state.correction!.originNode === "Parametrizer Verificator";

    const prompt = !thereIsACorrection
      ? `Plan: ${state.plan}\n\nHerramienta: ${selectedPlugin.name}`
      : isAParametrizerError
        ? `Plan: ${state.plan}\n\nHerramienta: ${selectedPlugin.name}\n\nEl intento anterior generó estos argumentos, que no cumplieron el esquema esperado:\n${JSON.stringify(state.correction!.failedArgs)}\n\nMotivo: ${state.correction!.reason}\n\nCorregí específicamente lo señalado, sin modificar los campos que no fueron mencionados como incorrectos.`
        : `Plan: ${state.plan}\n\nHerramienta: ${selectedPlugin.name}\n\nSe ejecutó esta herramienta con los siguientes argumentos y falló en tiempo de ejecución, no por el esquema:\n${JSON.stringify(state.correction!.failedArgs)}\n\nMotivo del fallo: ${state.correction!.reason}\n\nRevisá si el problema puede resolverse con valores distintos para esos mismos campos.`;

    const response = await parametrizerModel.invoke([
      new SystemMessage(`Sos el componente parametrizador de HiveQueen. Ya se decidió qué
    herramienta usar; tu única tarea es completar sus parámetros a partir
    del plan y del pedido original, siguiendo exactamente el esquema que se
    te especifica.

    No cuestiones si la herramienta es la correcta: eso ya fue decidido
    antes. Completá cada campo con la mejor información disponible en el
    plan. Si un dato no está explícito pero se puede inferir razonablemente
    del contexto, inferilo. Si un campo es obligatorio y no hay forma
    razonable de completarlo, usá el valor que mejor se ajuste a la
    intención del pedido, no un valor vacío o inventado sin relación.

    A veces vas a recibir información sobre un intento anterior que no
    cumplió el esquema esperado. Cuando eso ocurra, corregí específicamente
    lo que se señala como incorrecto, sin modificar los campos que ya
    estaban bien.`),
      new HumanMessage(prompt),
    ]);

    const result = selectedPlugin.schema.safeParse(
      JSON.parse(response.content as string),
    );

    if (!result.success) {
      return {
        correction: {
          originNode: "Parametrizer",
          reason: `Los argumentos generados para "${selectedPlugin.name}" no cumplen su esquema de parámetros: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
          tool: state.selectedTool,
          failedArgs: JSON.parse(response.content as string),
          type: "parameterization",
        },
        parametrizerAttempts: 1,
        messages: [response],
      };
    }

    return {
      args: {
        originNode: "Parametrizer",
        params: result.data,
      },
      messages: [response],
    };
  };

  const ParametrizerVerificator: GraphNode<typeof PEVState> = async (state) => {
    const ParametrizerVerificatorResponse = z.object({
      isCorrect: z.boolean(),
      reason: z.string(),
    });

    const parametrizerVerificatorModel = new ChatOllama({
      model: state.model,
      think: true,
      numCtx: 8192,
      keepAlive: "10m",
      format: z.toJSONSchema(ParametrizerVerificatorResponse),
    });

    const selectedPlugin = catalog.find((c) => c.name === state.selectedTool)!;
    const humanPrompt = `Plan: ${state.plan}

    Herramienta: ${selectedPlugin.name}
    Descripción de la herramienta: ${selectedPlugin.description}

    Esquema de parámetros esperado:
    ${JSON.stringify(z.toJSONSchema(selectedPlugin.schema))}

    Argumentos generados: ${JSON.stringify(state.args.params)}`;

    const response = await parametrizerVerificatorModel.invoke([
      new SystemMessage(`Sos el verificador de argumentos de HiveQueen. Tu única tarea es juzgar
    si los argumentos generados para una herramienta tienen sentido en
    relación con el pedido del usuario y el plan de razonamiento — antes de
    que la herramienta se haya ejecutado.

    No evalúes si la herramienta elegida es la correcta: eso ya fue decidido
    antes. No evalúes si los argumentos cumplen el formato o tipo esperado:
    eso ya fue validado antes de que llegues a intervenir. Juzgá únicamente
    si, dado el plan, los valores concretos elegidos para cada parámetro
    son razonables — por ejemplo, si un valor parece inventado sin base en
    el pedido, si contradice algo que el plan señala, o si ignora una
    ambigüedad que el plan pidió verificar antes de asumir una respuesta
    única.`),
      new HumanMessage(humanPrompt),
    ]);

    const result = JSON.parse(response.content as string);

    return result.isCorrect
      ? { correction: undefined, messages: [response] }
      : {
          correction: {
            originNode: "Parametrizer Verificator",
            reason: result.reason,
            tool: state.selectedTool,
            failedArgs: state.args.params,
            type: "parameterization",
          },
          parametrizerAttempts: 1,
          messages: [response],
        };
  };

  const Executor: GraphNode<typeof PEVState> = async (state) => {
    return { toolResult: "Ejecutado" };
  };

  const ExecutorVerificator: GraphNode<typeof PEVState> = async (state) => {
    const ExecuteVerificatorResponse = z.object({
      isCorrect: z.boolean(),
      reason: z.string(),
      type: z.enum(["parameterization", "execution", "other", "correct"]),
    });

    const ExecuteVerificatorModel = new ChatOllama({
      model: state.model,
      think: true,
      numCtx: 8192,
      keepAlive: "10m",
      format: z.toJSONSchema(ExecuteVerificatorResponse),
    });

    const selectedPlugin = catalog.find((c) => c.name === state.selectedTool)!;
    const humanPrompt = `Plan: ${state.plan}

Herramienta ejecutada: ${selectedPlugin.name}
Argumentos usados: ${JSON.stringify(state.args.params)}

Resultado de la ejecución: ${state.toolResult}`;

    const response = await ExecuteVerificatorModel.invoke([
      new SystemMessage(`Sos el verificador de ejecución de HiveQueen. Tu única tarea es juzgar
    qué pasó después de que una herramienta ya fue invocada con argumentos
    concretos, y decidir cómo seguir.

    Se te va a mostrar el plan, la herramienta usada, los argumentos con los
    que se ejecutó, y el resultado real de esa ejecución (que puede ser un
    éxito o un mensaje de error).

    Si el resultado indica éxito y resuelve lo que el plan buscaba, marcá
    isCorrect en true y type en "correct".

    Si el resultado indica un fallo, decidí a cuál de estas tres categorías
    corresponde:

    - "parameterization": el fallo se explica por un valor de argumento mal
    formado o inconsistente con lo que el pedido describe — por ejemplo,
    una ruta que no sigue el formato esperado, o un valor que no
    corresponde al dato que el plan pedía. Corresponde cuando ajustar los
    argumentos, sin cambiar de herramienta, resolvería el problema.

    - "execution": el fallo no es de los argumentos, sino de que esta
    herramienta no era la indicada para la tarea, o falló por una causa
    puntual que otra herramienta podría evitar. Corresponde cuando vale la
    pena intentar con una herramienta distinta.

    - "other": el fallo se debe a una condición externa que ninguna
    herramienta alternativa ni ningún ajuste de argumentos podría resolver
    — por ejemplo, un permiso del sistema denegado, un servicio externo
    no disponible, o una limitación del entorno. Corresponde cuando
    reintentar de cualquier forma sería inútil.

    Elegí "execution" en vez de "other" salvo que estés seguro de que ningún
    cambio de herramienta ni de argumento podría funcionar.`),
      new HumanMessage(humanPrompt),
    ]);

    const result = JSON.parse(response.content as string);

    return result.isCorrect
      ? { correction: undefined, messages: [response] }
      : {
          correction: {
            originNode: "Executor Verificator",
            reason: result.reason,
            tool: state.selectedTool,
            failedArgs: state.args.params,
            type: result.type,
          },
          messages: [response],
          ...(result.type === "parameterization"
            ? { parametrizerAttempts: 1 }
            : result.type === "execution"
              ? { selectionAttempts: 1 }
              : {}),
        };
  };

  const HiveQueenResponder: GraphNode<typeof PEVState> = async (state) => {
    const responder = new ChatOllama({
      model: state.model,
      think: false,
      temperature: 0.0,
      keepAlive: "10m",
      numCtx: 8192,
    });

    const isNoToolNeeded = state.selectedTool === "NINGUNO_APLICA";
    const isUnrecoverableFailure =
      state.correction && state.correction.type === "other";
    const outOfAttempts =
      state.selectionAttempts > 5 || state.parametrizerAttempts > 5;

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
            humanPrompt: `Pedido del usuario: ${state.userPrompt}\n\nSe intentó resolver esto con la herramienta "${state.correction!.tool}" y no fue posible completarlo. Motivo técnico: ${state.correction!.reason}`,
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
              humanPrompt: `Pedido del usuario: ${state.userPrompt}\n\nHerramienta usada: ${state.selectedTool}\n\nArgumentos: ${JSON.stringify(state.args.params)}\n\nResultado obtenido: ${state.toolResult}`,
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

    const response = await responder.invoke([
      new SystemMessage(prompts.systemPrompt),
      new HumanMessage(prompts.humanPrompt),
    ]);

    return {
      finalAnswer: response.content as string,
      messages: [response],
    };
  };

  const shouldRespond = (state: typeof PEVState.State) => {
    return state.selectionAttempts > 5 ||
      state.selectedTool === "NINGUNO_APLICA"
      ? "HiveQueenResponder"
      : "SelectorVerificator";
  };

  const shouldParameterize = (state: typeof PEVState.State) => {
    return state.selectionAttempts > 5
      ? "HiveQueenResponder"
      : state.correction
        ? "Selector"
        : "Parametrizer";
  };

  const shouldVerifyArgs = (state: typeof PEVState.State) => {
    return state.selectionAttempts > 5 || state.parametrizerAttempts > 5
      ? "HiveQueenResponder"
      : state.correction && state.correction.type === "selection"
        ? "Selector"
        : state.correction && state.correction.type === "parameterization"
          ? "Parametrizer"
          : "ParametrizerVerificator";
  };

  const shouldExecute = (state: typeof PEVState.State) => {
    return state.parametrizerAttempts > 5
      ? "HiveQueenResponder"
      : state.correction
        ? "Parametrizer"
        : "Executor";
  };

  const shouldLoop = (state: typeof PEVState.State) => {
    return state.selectionAttempts > 5 || state.parametrizerAttempts > 5
      ? "HiveQueenResponder"
      : state.correction && state.correction.type === "parameterization"
        ? "Parametrizer"
        : state.correction && state.correction.type === "execution"
          ? "Selector"
          : "HiveQueenResponder";
  };

  const PEV = new StateGraph(PEVState)
    .addNode("Planner", Planner)
    .addNode("Selector", Selector)
    .addNode("SelectorVerificator", SelectorVerificator)
    .addNode("Parametrizer", Parametrizer)
    .addNode("ParametrizerVerificator", ParametrizerVerificator)
    .addNode("Executor", Executor)
    .addNode("ExecutorVerificator", ExecutorVerificator)
    .addNode("HiveQueenResponder", HiveQueenResponder)
    .addEdge(START, "Planner")
    .addEdge("Planner", "Selector")
    .addConditionalEdges("Selector", shouldRespond, [
      "HiveQueenResponder",
      "SelectorVerificator",
    ])
    .addConditionalEdges("SelectorVerificator", shouldParameterize, [
      "Parametrizer",
      "Selector",
    ])
    .addConditionalEdges("Parametrizer", shouldVerifyArgs, [
      "ParametrizerVerificator",
      "Selector",
      "Parametrizer",
    ])
    .addConditionalEdges("ParametrizerVerificator", shouldExecute, [
      "Executor",
      "Parametrizer",
    ])
    .addEdge("Executor", "ExecutorVerificator")
    .addConditionalEdges("ExecutorVerificator", shouldLoop, [
      "Selector",
      "Parametrizer",
      "HiveQueenResponder",
    ])
    .addEdge("HiveQueenResponder", END)
    .compile();

  const result = await PEV.invoke({
    model,
    userPrompt: query,
  });

  return result;
}
