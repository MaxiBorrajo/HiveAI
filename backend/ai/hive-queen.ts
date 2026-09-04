import {
  StateSchema,
  StateGraph,
  MessagesValue,
  ReducedValue,
  type GraphNode,
  START,
  END,
} from "@langchain/langgraph";
import { ChatOllama } from "@langchain/ollama";
import {
  AIMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import z from "zod";
import {
  RESPONDER_SYSTEM_PROMPT,
  SELECTOR_SYSTEM_PROMPT,
  getRuntimeOsLine,
} from "./constants.ts";
import { HiveMicrokernel } from "../microkernel/hive-microkernel.ts";
import { captureSteps } from "../microkernel/step-capture.ts";

// Computed once: the runtime OS doesn't change between turns.
const OS_LINE = getRuntimeOsLine();

const ChatStepSchema = z.object({
  node: z.enum(["Selector", "Executor", "HiveQueen", "Plugin"]),
  label: z.string(),
  durationMs: z.number(),
  summary: z.string(),
});
export type ChatStep = z.infer<typeof ChatStepSchema>;

const StepsValue = new ReducedValue(z.array(ChatStepSchema).default([]), {
  reducer: (current, next) => [...current, ...next],
});

export const HiveAIState = new StateSchema({
  messages: MessagesValue,
  model: z.string(),
  steps: StepsValue,
});

// Truncates a node's output to a single log-friendly line — full tool results
// can be thousands of characters and would drown out the timing signal.
function summarize(text: string, maxChars = 200): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > maxChars ? `${oneLine.slice(0, maxChars)}...` : oneLine;
}

// bindTools() re-serializes every tool's schema to JSON on each call, which is
// wasted work when the active plugin set hasn't changed since the last turn —
// re-created only when the model or the set of active tool names differs from
// the previous turn.
let cachedBoundSelector: ReturnType<ChatOllama["bindTools"]> | null = null;
let cachedKey = "";

function getBoundSelector(
  model: string,
  tools: ReturnType<typeof HiveMicrokernel.prototype.getTools>,
) {
  const key = `${model}:${tools.map((t) => t.name).sort().join(",")}`;

  if (!cachedBoundSelector || cachedKey !== key) {
    const selectorModel = new ChatOllama({
      model,
      think: false,
      numCtx: 8192,
      keepAlive: "10m",
    });
    cachedBoundSelector = selectorModel.bindTools(tools);
    cachedKey = key;
  }

  return cachedBoundSelector;
}

const HiveQueenResponder: GraphNode<typeof HiveAIState> = async (state) => {
  const start = performance.now();

  const responder = new ChatOllama({
    model: state.model,
    think: true,
    keepAlive: "10m",
    numCtx: 8192,
  });

  const response = await responder.invoke([
    new SystemMessage(RESPONDER_SYSTEM_PROMPT(OS_LINE)),
    ...state.messages,
  ]);

  const durationMs = performance.now() - start;
  const summary = summarize(String(response.content));

  return {
    messages: [response],
    steps: [{ node: "HiveQueen", label: "Redactando respuesta", durationMs, summary }],
  };
};

const Selector: GraphNode<typeof HiveAIState> = async (state) => {
  const microkernel = HiveMicrokernel.getInstance();
  const tools = microkernel.getTools();
  const start = performance.now();

  const response = await getBoundSelector(state.model, tools).invoke([
    new SystemMessage(SELECTOR_SYSTEM_PROMPT(OS_LINE)),
    ...state.messages,
  ]);

  const durationMs = performance.now() - start;
  const toolNames = (response.tool_calls ?? []).map((tc) => tc.name).join(", ") || "none";

  const step: ChatStep = {
    node: "Selector",
    label: "Eligiendo herramienta",
    durationMs,
    summary: `Decidió: ${toolNames}`,
  };

  if (!response.tool_calls?.length) {
    return { messages: [], steps: [step] };
  }

  return { messages: [response], steps: [step] };
};

const Executor: GraphNode<typeof HiveAIState> = async (state) => {
  const lastMessage = state.messages.at(-1);

  if (lastMessage == null || !AIMessage.isInstance(lastMessage)) {
    return { messages: [] };
  }

  const microkernel = HiveMicrokernel.getInstance();
  const results: ToolMessage[] = [];
  const steps: ChatStep[] = [];

  for (const toolCall of lastMessage.tool_calls ?? []) {
    const tool = microkernel.getTool(toolCall.name);
    const start = performance.now();

    if (!tool) {
      steps.push({
        node: "Executor",
        label: toolCall.name,
        durationMs: performance.now() - start,
        summary: "No existe esa herramienta en la colmena",
      });
      results.push(
        new ToolMessage({
          tool_call_id: toolCall.id ?? "",
          name: toolCall.name,
          content: `There is no tool named '${toolCall.name}' in the hive.`,
          status: "error",
        }),
      );
      continue;
    }

    try {
      const { result, steps: pluginSteps } = await captureSteps(() =>
        tool.invoke(toolCall),
      );
      const durationMs = performance.now() - start;
      const summary = summarize(String(result.content));

      for (const pluginStep of pluginSteps) {
        steps.push({
          node: "Plugin",
          label: toolCall.name,
          durationMs: 0,
          summary: pluginStep.label,
        });
      }
      steps.push({ node: "Executor", label: toolCall.name, durationMs, summary });
      results.push(result);
    } catch (error) {
      const durationMs = performance.now() - start;
      const detail = error instanceof Error ? error.message : String(error);
      steps.push({
        node: "Executor",
        label: toolCall.name,
        durationMs,
        summary: `Error: ${detail}`,
      });
      results.push(
        new ToolMessage({
          tool_call_id: toolCall.id ?? "",
          name: toolCall.name,
          content: `Tool '${toolCall.name}' failed: ${detail}`,
          status: "error",
        }),
      );
    }
  }

  return { messages: results, steps };
};

const shouldExecute = (state: typeof HiveAIState.State) => {
  const last = state.messages.at(-1);
  return AIMessage.isInstance(last) && last.tool_calls?.length
    ? "Executor"
    : "HiveQueen";
};

// Skips the Selector entirely when there are no active plugins to choose
// from — there's nothing for it to decide, so invoking it would just be an
// LLM call that always comes back empty.
const hasActivePlugins = () =>
  HiveMicrokernel.getInstance().getTools().length > 0
    ? "Selector"
    : "HiveQueen";

export const HiveMind = new StateGraph(HiveAIState)
  .addNode("Selector", Selector)
  .addNode("Executor", Executor)
  .addNode("HiveQueen", HiveQueenResponder)
  .addConditionalEdges(START, hasActivePlugins, ["Selector", "HiveQueen"])
  .addConditionalEdges("Selector", shouldExecute, ["Executor", "HiveQueen"])
  .addEdge("Executor", "HiveQueen")
  .addEdge("HiveQueen", END)
  .compile();
