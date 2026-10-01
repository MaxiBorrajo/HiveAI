import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { GraphNode } from "@langchain/langgraph/web";
import { ChatOllama } from "@langchain/ollama";
import { HiveMicrokernel } from "../../../../microkernel/hive-microkernel.ts";
import { HiveAIState, type ChatStep } from "../graph.ts";
import { buildSolverSystemPrompt } from "./prompt.ts";
import { MAX_ATTEMPTS } from "../constants.ts";
import { buildNativeTools, getNativeTool } from "../../shared/native-tools.ts";

export const Solver: GraphNode<typeof HiveAIState> = async (state) => {
  const start = performance.now();
  const microkernel = HiveMicrokernel.getInstance();

  console.log(`[SADER - Solver] state.modelOptions:`, state.modelOptions);
  const selectorOptions = {
    model: state.selectorModel,
    think: true,
    ...state.modelOptions,
  };
  const selectorModel = new ChatOllama(selectorOptions);

  console.log(`[SADER - Solver] Effective Ollama options:`, selectorOptions);

  const correctionMessages = state.corrections.length
    ? state.corrections.map(
        (correction) =>
          new HumanMessage(
            `A previous attempt was tried using the tool "${correction.tool}" with these arguments: ${JSON.stringify(correction.failedArgs ?? {})}, and it did not work. Reason: ${correction.reason}. Choose the most appropriate tool again for this specific call (it can be a different one, or the same one with corrected arguments) and fill in its parameters.`,
          ),
      )
    : [];

  console.log(`\n[SADER - Solver] Starting tool selection phase`);
  if (correctionMessages.length > 0) {
    console.log(
      `[SADER - Solver] Applying correction context:`,
      state.corrections,
    );
  }

  const nativeTools = buildNativeTools(state.chatId);

  const response = await selectorModel
    .bindTools([...microkernel.getTools(), ...nativeTools])
    .invoke([
      new SystemMessage(buildSolverSystemPrompt()),
      ...state.messages,
      ...correctionMessages,
    ]);

  console.log(`[SADER - Solver] Raw model response:`, response.content);
  console.log(`[SADER - Solver] Tool calls requested:`, response.tool_calls);

  const toolNames =
    (response.tool_calls ?? []).map((tc) => tc.name).join(", ") || "none";
  console.log(`[SADER - Solver] Selector decided: [${toolNames}]`);

  const durationMs = performance.now() - start;

  if (!response.tool_calls?.length) {
    return {
      pendingToolCalls: [],
      corrections: [],
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

  const pendingToolCalls: { tool: string; args: Record<string, unknown> }[] =
    [];
  const corrections: {
    tool: string;
    reason: string;
    failedArgs?: Record<string, unknown>;
  }[] = [];
  const decidedSummaries: string[] = [];

  for (const call of response.tool_calls) {
    if (getNativeTool(call.name, state.chatId)) {
      pendingToolCalls.push({
        tool: call.name,
        args: call.args as Record<string, unknown>,
      });
      decidedSummaries.push(`Decided: ${call.name}`);
      continue;
    }

    const selectedPlugin = microkernel.getPlugin(call.name);

    if (!selectedPlugin) {
      corrections.push({
        tool: call.name,
        reason: `The tool "${call.name}" does not exist in the available plugins catalog.`,
        failedArgs: call.args,
      });
      decidedSummaries.push(
        `Decided: ${call.name} (does not exist in catalog)`,
      );
      continue;
    }

    const parsed = selectedPlugin.schema.safeParse(call.args);

    if (!parsed.success) {
      corrections.push({
        tool: call.name,
        reason: `The generated arguments for "${call.name}" do not match its parameter schema: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        failedArgs: call.args,
      });
      decidedSummaries.push(`Decided: ${call.name} (invalid parameters)`);
      continue;
    }

    pendingToolCalls.push({
      tool: call.name,
      args: parsed.data as Record<string, unknown>,
    });
    decidedSummaries.push(`Decided: ${call.name}`);
  }

  return {
    pendingToolCalls,
    corrections,
    attempts: corrections.length ? 1 : 0,
    selectionAttempts: corrections.some((c) =>
      c.reason.includes("does not exist"),
    )
      ? 1
      : 0,
    parametrizerAttempts: corrections.some((c) =>
      c.reason.includes("do not match its parameter schema"),
    )
      ? 1
      : 0,
    messages: [response],
    steps: [
      {
        node: "Solver" as const,
        label: "Choosing tool",
        durationMs,
        summary: decidedSummaries.join("; "),
      } satisfies ChatStep,
    ],
  };
};

export const shouldRespond = (state: typeof HiveAIState.State) => {
  if (state.pendingToolCalls.length === 0) {
    if (state.corrections.length > 0) {
      return state.attempts > MAX_ATTEMPTS ? "HiveQueenResponder" : "Solver";
    }
    if (state.hasChainedToolResult) return "HiveQueenResponder";
    if (state.abstentionVerified) return "HiveQueenResponder";
    return "AbstentionVerificator";
  }
  if (state.attempts > MAX_ATTEMPTS) return "HiveQueenResponder";
  return "Executor";
};
