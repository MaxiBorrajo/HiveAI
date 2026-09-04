import { SystemMessage } from "@langchain/core/messages";
import { GraphNode } from "@langchain/langgraph/web";
import { ChatOllama } from "@langchain/ollama";
import { HiveMicrokernel } from "../../../../microkernel/hive-microkernel.ts";
import { HiveAIState } from "../graph.ts";
import { SOLVER_SYSTEM_PROMPT } from "./prompt.ts";

export const Solver: GraphNode<typeof HiveAIState> = async (state) => {
  const microkernel = HiveMicrokernel.getInstance();

  const selectorModel = new ChatOllama({
    model: state.selectorModel,
    think: false,
    temperature: 0,
  });

  const response = await selectorModel
    .bindTools(microkernel.getTools())
    .invoke([new SystemMessage(SOLVER_SYSTEM_PROMPT), ...state.messages]);

  console.log(
    `Selector decided: [${(response.tool_calls ?? []).map((tc) => tc.name).join(", ") || "none"}]`,
  );

  if (!response.tool_calls?.length) {
    return {
      selectedTool: "NONE",
      correction: null,
      abstentionVerified: false,
      messages: [response],
    };
  }

  const call = response.tool_calls[0];
  const selectedPlugin = microkernel.getPlugin(call.name);

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
    };
  }

  return {
    selectedTool: call.name,
    args: { params: parsed.data },
    correction: null,
    messages: [response],
  };
};

export const shouldRespond = (state: typeof HiveAIState.State) => {
  if (state.selectedTool === "NONE") {
    if (state.abstentionVerified) return "HiveQueenResponder";
    return "AbstentionVerificator";
  }
  if (state.attempts > 1) return "HiveQueenResponder";
  if (state.correction) return "Solver";
  return "Executor";
};
