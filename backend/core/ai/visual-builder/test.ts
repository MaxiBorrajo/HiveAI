import { buildStateSchema, compileGraph, NodeRegistry } from "./compiler.ts";
import { LangGraphAbstraction, StatePropertyDefinition } from "./types.ts";
import { ChatOllama } from "@langchain/ollama";

// ==========================================
// 1. ESTADO: Generador de Contenido con QA
// ==========================================
const stateDef: Record<string, StatePropertyDefinition> = {
  // Historial completo
  messages: {
    type: "array",
    items: { type: "object", required: false },
    reducerStrategy: "append",
    required: true,
  },
  // Feedback del evaluador (se pisa en cada iteración)
  feedback: {
    type: "string",
    reducerStrategy: "overwrite",
    required: false,
    default: "",
  },
  // Resultado de la evaluación ("pass" o "fail")
  quality: {
    type: "string",
    reducerStrategy: "overwrite",
    required: false,
    default: "pending",
  },
  // Contador de intentos
  attempts: {
    type: "number",
    reducerStrategy: "sum",
    required: true,
    default: 0,
  },
};

// ==========================================
// 2. EL GRAFO (JSON desde la Base de Datos)
// ==========================================
const abstraction: LangGraphAbstraction = {
  nodes: [
    {
      id: "node_writer",
      name: "Escritor Creativo",
      type: "llm",
      config: {
        pluginId: "ollama_writer",
        model: "llama3.2",
        plugins: ["search_web"],
      },
    },
    {
      id: "node_qa",
      name: "Evaluador de Calidad",
      type: "compute",
      config: { pluginId: "mock_qa" },
    },
  ],
  edges: [
    // Flujo inicial: Inicia y va directo al escritor
    {
      id: "e1",
      source: "start",
      target: "node_writer",
      isConditional: false,
    },
    // Del escritor siempre pasa al evaluador
    {
      id: "e2",
      source: "node_writer",
      target: "node_qa",
      isConditional: false,
    },
    // --- CONDICIONALES DESDE QA ---
    // Si aprueba -> Termina
    {
      id: "e3",
      source: "node_qa",
      target: "end",
      isConditional: true,
      condition: { field: "quality", operator: "equals", value: "pass" },
    },
    // Si falla pero ya intentó 3 veces -> Termina (se rinde)
    {
      id: "e4",
      source: "node_qa",
      target: "end",
      isConditional: true,
      condition: {
        field: "attempts",
        operator: "greater_than_or_equals",
        value: 3,
      },
    },
    // Si falla y lleva menos de 3 intentos -> Vuelve al escritor
    {
      id: "e5",
      source: "node_qa",
      target: "node_writer",
      isConditional: true,
      condition: { field: "quality", operator: "equals", value: "fail" }, // Nota: El router evalúa en orden. Si entra a este, es porque intentos < 3.
    },
  ],
};

// ==========================================
// 3. LOS PLUGINS (Ejecutores genéricos)
// ==========================================
const registry: NodeRegistry = {
  // Ejecutor genérico para nodos tipo "llm"
  llm: async (state, config) => {
    console.log(
      `\n[Escritor] Redactando... (Intento #${(state.attempts as number) + 1})`,
    );

    // Verificamos si vinieron tools inyectados desde el microkernel
    if (config.resolvedTools && (config.resolvedTools as any[]).length > 0) {
      console.log(
        `[Escritor] Herramientas del microkernel disponibles: ${(config.resolvedTools as any[]).length}`,
      );
    }

    let prompt = "Escribe un chiste corto.";
    if (state.feedback) {
      prompt += `\nTEN EN CUENTA ESTE FEEDBACK ANTERIOR: ${state.feedback}`;
    }

    let responseText = "";
    try {
      const llm = new ChatOllama({
        model: config.model as string,
        temperature: 0.8,
      });
      // Aquí harías llm.bindTools(config.resolvedTools).invoke(...) si tuvieras tools
      const response = await llm.invoke([["user", prompt]]);
      responseText = response.content as string;
    } catch (e: any) {
      responseText = `(Chiste de fallback por error de red)`;
    }

    return {
      messages: [{ role: "assistant", content: responseText }],
      attempts: 1, // El reducer lo suma
    };
  },

  // Plugin 2: Revisa el texto y decide si pasa (nodo tipo 'compute')
  mock_qa: async (state, _config) => {
    console.log(`[QA] Evaluando el texto generado...`);

    // Obtenemos el último mensaje generado por el escritor
    const messages = state.messages as any[];
    const lastMessage = messages[messages.length - 1].content;

    // Lógica compleja simulada
    if ((state.attempts as number) < 2) {
      console.log(`[QA] ❌ Rechazado. Falta gracia.`);
      return {
        quality: "fail", // El reducer lo sobreescribe
        feedback:
          "El chiste es muy aburrido. Intenta hacerlo sobre animales y que rime.", // El reducer lo sobreescribe
      };
    } else {
      console.log(`[QA] ✅ Aprobado. ¡Está genial!`);
      return {
        quality: "pass",
        feedback: "Perfecto.",
      };
    }
  },
};

// ==========================================
// 4. EJECUCIÓN DEL COMPILADOR
// ==========================================
async function main() {
  console.log("Compilando arquitectura compleja...");
  const schema = buildStateSchema(stateDef);

  // Fake Microkernel for testing
  const fakeMicrokernel = {
    getTool: (name: string) => {
      console.log(`Microkernel devolviendo tool: ${name}`);
      return { name, description: "Fake tool" }; // Fake Langchain Tool
    },
  };

  const app = compileGraph(abstraction, schema, registry, fakeMicrokernel);

  const initialState = {
    messages: [],
    attempts: 0,
    quality: "pending",
    feedback: "",
  };

  const finalState = await app.invoke(initialState);

  console.log("\n==================================");
  console.log("ESTADO FINAL:");
  console.log("Intentos totales:", finalState.attempts);
  console.log("Calidad final:", finalState.quality);
  console.log("\nHISTORIAL EVOLUTIVO:");
  finalState.messages.forEach((msg: any, i: number) => {
    console.log(
      `[Iteración ${i + 1}] -> ${msg.content.substring(0, 80).replace(/\n/g, " ")}...`,
    );
  });
}

if (import.meta.main) {
  main().catch(console.error);
}
