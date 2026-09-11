import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { GraphNode } from "@langchain/langgraph/web";
import { END } from "@langchain/langgraph";
import { ChatOllama } from "@langchain/ollama";
import { HiveMicrokernel } from "../../../../microkernel/hive-microkernel.ts";
import { ScoutState, type ChatStep } from "../graph.ts";
import { buildAgentSystemPrompt, AGENT_OUT_OF_ITERATIONS_PROMPT } from "./prompt.ts";
import { MAX_AGENT_ITERATIONS } from "../constants.ts";
import { buildNativeTools } from "../../SADER/nativeTools.ts";

export const Agent: GraphNode<typeof ScoutState> = async (state) => {
  const start = performance.now();
  const microkernel = HiveMicrokernel.getInstance();

  const outOfIterations = state.iterations >= MAX_AGENT_ITERATIONS;

  console.log(`[SCOUT - Agent] state.modelOptions:`, state.modelOptions);
  const agentOptions = {
    model: state.model,
    think: true,
    ...state.modelOptions,
  };
  const agentModel = new ChatOllama(agentOptions);

  console.log(`[SCOUT - Agent] Effective Ollama options:`, agentOptions);
  console.log(
    `\n[SCOUT - Agent] Starting turn (iteration ${state.iterations}${outOfIterations ? ", out of tool budget" : ""})`,
  );

  const systemMessages = [
    new SystemMessage(buildAgentSystemPrompt()),
    ...(outOfIterations ? [new HumanMessage(AGENT_OUT_OF_ITERATIONS_PROMPT)] : []),
  ];

  const response = outOfIterations
    ? await agentModel.invoke([...systemMessages, ...state.messages])
    : await agentModel
        .bindTools([...microkernel.getTools(), ...buildNativeTools(state.chatId)])
        .invoke([...systemMessages, ...state.messages]);

  console.log(`[SCOUT - Agent] Raw model response:`, response.content);
  console.log(`[SCOUT - Agent] Tool calls requested:`, response.tool_calls);

  const durationMs = performance.now() - start;
  const toolNames = (response.tool_calls ?? []).map((tc) => tc.name).join(", ");

  return {
    messages: [response],
    iterations: 1,
    steps: [
      {
        node: "Agent" as const,
        label: response.tool_calls?.length ? "Choosing tools" : "Drafting response",
        durationMs,
        summary: response.tool_calls?.length
          ? `Decided: ${toolNames}`
          : String(response.content).replace(/\s+/g, " ").trim().slice(0, 200),
      } satisfies ChatStep,
    ],
  };
};

export const shouldContinue = (state: typeof ScoutState.State) => {
  const last = state.messages[state.messages.length - 1];
  if (AIMessage.isInstance(last) && last.tool_calls?.length) return "Executor";
  return END;
};
