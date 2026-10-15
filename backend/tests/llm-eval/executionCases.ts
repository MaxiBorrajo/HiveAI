import type { LangGraphAbstraction } from "../../core/ai/visual-builder/types.ts";

export interface ExecutionEvalCase {
  name: string;
  /** "execution" cases run through the model; nothing here needs activePlugins
   *  beyond what the graph itself references via pluginId. */
  activePlugins: string[];
  inputState: Record<string, unknown>;
  buildGraph: () => LangGraphAbstraction;
  /** Checked against the finalState returned by app.invoke(). */
  expectedResultCheck: (finalState: Record<string, unknown>) => boolean;
  expectedResultDescription: string;
}

function counterGraph(): LangGraphAbstraction {
  return {
    nodes: [
      { id: "start", name: "Start", type: "start", config: {} },
      {
        id: "count_step",
        name: "Count Step",
        type: "plugin",
        config: {
          pluginId: "counter",
          inputMapping: { name: "counter_name", action: "action", amount: "amount" },
          outputKey: "count_result",
        },
      },
      { id: "end", name: "End", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "count_step", isConditional: false },
      { id: "e2", source: "count_step", target: "end", isConditional: false },
    ],
    stateSchema: {
      counter_name: { type: "string", required: true },
      action: { type: "string", required: true },
      amount: { type: "number", required: false },
      count_result: { type: "string", required: false },
    },
  };
}

function reasoningSummaryGraph(executorModel: string, provider: string, keyId?: string): LangGraphAbstraction {
  return {
    nodes: [
      { id: "start", name: "Start", type: "start", config: {} },
      {
        id: "summarize_step",
        name: "Summarize",
        type: "llm",
        config: {
          model: executorModel,
          provider,
          ...(keyId ? { keyId } : {}),
          systemPrompt:
            "Summarize the given text in a single short sentence. Reply with only the sentence, nothing else.",
          outputKey: "summary",
        },
      },
      { id: "end", name: "End", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "summarize_step", isConditional: false },
      { id: "e2", source: "summarize_step", target: "end", isConditional: false },
    ],
    stateSchema: {
      input: { type: "string", required: true },
      summary: { type: "string", required: false },
    },
  };
}

function classifyAndBranchGraph(executorModel: string, provider: string, keyId?: string): LangGraphAbstraction {
  return {
    nodes: [
      { id: "start", name: "Start", type: "start", config: {} },
      {
        id: "classify_step",
        name: "Classify Sentiment",
        type: "llm",
        config: {
          model: executorModel,
          provider,
          ...(keyId ? { keyId } : {}),
          systemPrompt:
            "Classify the sentiment of the given text as exactly one word: 'positive' or 'negative'. Reply with only that word.",
          outputKey: "sentiment",
        },
      },
      {
        id: "is_positive",
        name: "Is positive?",
        type: "condition",
        config: {
          condition: { field: "sentiment", operator: "contains", value: "positive" },
        },
      },
      {
        id: "positive_step",
        name: "Positive Reply",
        type: "llm",
        config: {
          model: executorModel,
          provider,
          ...(keyId ? { keyId } : {}),
          systemPrompt: "Reply with exactly: 'Thanks for the kind words!'",
          outputKey: "final_reply",
        },
      },
      {
        id: "negative_step",
        name: "Negative Reply",
        type: "llm",
        config: {
          model: executorModel,
          provider,
          ...(keyId ? { keyId } : {}),
          systemPrompt: "Reply with exactly: 'Sorry to hear that, let us help.'",
          outputKey: "final_reply",
        },
      },
      { id: "end", name: "End", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "classify_step", isConditional: false },
      { id: "e2", source: "classify_step", target: "is_positive", isConditional: false },
      { id: "e3", source: "is_positive", target: "positive_step", isConditional: true, path: "true" },
      { id: "e4", source: "is_positive", target: "negative_step", isConditional: true, path: "false" },
      { id: "e5", source: "positive_step", target: "end", isConditional: false },
      { id: "e6", source: "negative_step", target: "end", isConditional: false },
    ],
    stateSchema: {
      input: { type: "string", required: true },
      sentiment: { type: "string", required: false },
      final_reply: { type: "string", required: false },
    },
  };
}

export function buildExecutionCases(
  executorModel: string,
  provider: string,
  keyId?: string,
): ExecutionEvalCase[] {
  return [
    {
      name: "execution: a single plugin node increments a counter",
      activePlugins: ["counter"],
      inputState: { counter_name: "eval-pushups", action: "increment", amount: 1 },
      buildGraph: counterGraph,
      expectedResultCheck: (state) =>
        typeof state.count_result === "string" && state.count_result.length > 0,
      expectedResultDescription: "count_result is a non-empty string",
    },
    {
      name: "execution: a single plugin node resets a counter to zero",
      activePlugins: ["counter"],
      inputState: { counter_name: "eval-pushups", action: "reset" },
      buildGraph: counterGraph,
      expectedResultCheck: (state) =>
        typeof state.count_result === "string" && /\b0\b/.test(state.count_result),
      expectedResultDescription: "count_result mentions 0 after a reset",
    },
    {
      name: "execution (reasoning): an llm node summarizes a long input into one sentence",
      activePlugins: [],
      inputState: {
        input:
          "The quarterly report shows revenue grew 12% year over year, driven primarily by the new enterprise product line, while operating costs remained flat thanks to the infrastructure migration completed in March.",
      },
      buildGraph: () => reasoningSummaryGraph(executorModel, provider, keyId),
      expectedResultCheck: (state) =>
        typeof state.summary === "string" &&
        state.summary.length > 0 &&
        state.summary.length < 300,
      expectedResultDescription: "summary is a short non-empty string",
    },
    {
      name: "execution (reasoning): an llm node produces a one-sentence summary with no stray preamble",
      activePlugins: [],
      inputState: {
        input:
          "Cats are small domesticated carnivorous mammals known for their agility, independence, and role as popular household pets across the world.",
      },
      buildGraph: () => reasoningSummaryGraph(executorModel, provider, keyId),
      expectedResultCheck: (state) =>
        typeof state.summary === "string" &&
        !/^(sure|here is|here's)/i.test(state.summary.trim()),
      expectedResultDescription: "summary does not start with a conversational preamble",
    },
    {
      name: "execution (branching): classifies a clearly positive message and takes the positive branch",
      activePlugins: [],
      inputState: { input: "This is amazing, thank you so much for your help!" },
      buildGraph: () => classifyAndBranchGraph(executorModel, provider, keyId),
      expectedResultCheck: (state) => state.final_reply === "Thanks for the kind words!",
      expectedResultDescription: "final_reply matches the positive branch's fixed reply",
    },
    {
      name: "execution (branching): classifies a clearly negative message and takes the negative branch",
      activePlugins: [],
      inputState: { input: "This is terrible, nothing works and I'm very frustrated." },
      buildGraph: () => classifyAndBranchGraph(executorModel, provider, keyId),
      expectedResultCheck: (state) => state.final_reply === "Sorry to hear that, let us help.",
      expectedResultDescription: "final_reply matches the negative branch's fixed reply",
    },
  ];
}
