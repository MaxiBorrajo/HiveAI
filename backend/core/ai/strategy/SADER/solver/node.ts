import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { GraphNode } from "@langchain/langgraph/web";
import { ChatOllama } from "@langchain/ollama";
import { HiveMicrokernel } from "../../../../microkernel/hive-microkernel.ts";
import { HiveAIState, type ChatStep } from "../graph.ts";
import { buildSolverSystemPrompt } from "./prompt.ts";
import { MAX_ATTEMPTS } from "../constants.ts";

export const Solver: GraphNode<typeof HiveAIState> = async (state) => {
  const start = performance.now();
  const microkernel = HiveMicrokernel.getInstance();

  const selectorModel = new ChatOllama({
    model: state.selectorModel,
    think: true,
  });

  const correctionMessages = state.correction
    ? [
        new HumanMessage(
          `A previous attempt was tried using the tool "${state.correction.tool}" with these arguments: ${JSON.stringify(state.correction.failedArgs ?? {})}, and it did not work. Reason: ${state.correction.reason}. Choose the most appropriate tool again (it can be a different one, or the same one with corrected arguments) and fill in its parameters.`,
        ),
      ]
    : [];

  const response = await selectorModel
    .bindTools(microkernel.getTools())
    .invoke([
      new SystemMessage(buildSolverSystemPrompt()),
      ...state.messages,
      ...correctionMessages,
    ]);

  const toolNames =
    (response.tool_calls ?? []).map((tc) => tc.name).join(", ") || "none";
  console.log(`Selector decided: [${toolNames}]`);

  const durationMs = performance.now() - start;

  if (!response.tool_calls?.length) {
    return {
      selectedTool: "NONE",
      correction: null,
      abstentionVerified: false,
      messages: [response],
      steps: [
        {
          node: "Solver",
          label: "Choosing tool",
          durationMs,
          summary: "Decided not to invoke any tool",
        },
      ],
    };
  }

  const call = response.tool_calls[0];
  const selectedPlugin = microkernel.getPlugin(call.name);

  if (!selectedPlugin) {
    return {
      selectedTool: call.name,
      correction: {
        tool: call.name,
        reason: `The tool "${call.name}" does not exist in the available plugins catalog.`,
        failedArgs: call.args,
      },
      attempts: 1,
      selectionAttempts: 1,
      messages: [response],
      steps: [
        {
          node: "Solver",
          label: "Choosing tool",
          durationMs,
          summary: `Decided: ${call.name} (does not exist in catalog)`,
        },
      ],
    };
  }

  const parsed = selectedPlugin.schema.safeParse(call.args);

  if (!parsed.success) {
    return {
      selectedTool: call.name,
      correction: {
        tool: call.name,
        reason: `The generated arguments for "${call.name}" do not match its parameter schema: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        failedArgs: call.args,
      },
      attempts: 1,
      parametrizerAttempts: 1,
      messages: [response],
      steps: [
        {
          node: "Solver",
          label: "Choosing tool",
          durationMs,
          summary: `Decided: ${call.name} (invalid parameters)`,
        },
      ],
    };
  }

  return {
    selectedTool: call.name,
    args: { params: parsed.data as Record<string, unknown> },
    correction: null,
    messages: [response],
    steps: [
      {
        node: "Solver" as const,
        label: "Choosing tool",
        durationMs,
        summary: `Decided: ${call.name}`,
      } satisfies ChatStep,
    ],
  };
};

export const shouldRespond = (state: typeof HiveAIState.State) => {
  if (state.selectedTool === "NONE") {
    if (state.abstentionVerified) return "HiveQueenResponder";
    return "AbstentionVerificator";
  }
  if (state.attempts > MAX_ATTEMPTS) return "HiveQueenResponder";
  if (state.correction) return "Solver";
  return "Executor";
};