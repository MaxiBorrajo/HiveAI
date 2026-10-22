import type { LangGraphAbstraction } from "../../core/ai/visual-builder/types.ts";

/**
 * Some Ollama reasoning models (e.g. lfm2.5) emit a literal <think>...</think>
 * block as plain text even with `think: false`, since the plain-string
 * content path doesn't separate thinking from the final answer the way
 * structured providers do. Strip it before judging a case's output, so the
 * check reflects the actual answer rather than reasoning noise.
 */
export function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

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
          think: false,
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
          think: false,
          systemPrompt:
            "Classify the sentiment of the given text as exactly one word: 'positive' or 'negative'. Reply with only that word.",
          outputKey: "sentiment",
        },
      },
      {
        // Reasoning models mention both candidate words ("could be positive
        // or negative...") while thinking, which makes any contains/not_contains
        // check on the raw sentiment field unreliable. This node strips the
        // <think> block first so the condition below evaluates the model's
        // actual final answer, not its reasoning trail.
        id: "strip_think",
        name: "Clean sentiment",
        type: "plugin",
        config: {
          pluginId: "strip-think",
          inputMapping: { text: "sentiment" },
          outputKey: "sentiment_clean",
        },
      },
      {
        id: "is_positive",
        name: "Is positive?",
        type: "condition",
        config: {
          condition: { field: "sentiment_clean", operator: "contains", value: "positive" },
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
          think: false,
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
          think: false,
          systemPrompt: "Reply with exactly: 'Sorry to hear that, let us help.'",
          outputKey: "final_reply",
        },
      },
      { id: "end", name: "End", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "classify_step", isConditional: false },
      { id: "e2", source: "classify_step", target: "strip_think", isConditional: false },
      { id: "e3", source: "strip_think", target: "is_positive", isConditional: false },
      { id: "e4", source: "is_positive", target: "positive_step", isConditional: true, path: "true" },
      { id: "e5", source: "is_positive", target: "negative_step", isConditional: true, path: "false" },
      { id: "e6", source: "positive_step", target: "end", isConditional: false },
      { id: "e7", source: "negative_step", target: "end", isConditional: false },
    ],
    stateSchema: {
      input: { type: "string", required: true },
      sentiment: { type: "string", required: false },
      sentiment_clean: { type: "string", required: false },
      final_reply: { type: "string", required: false },
    },
  };
}

function counterThenFileGraph(): LangGraphAbstraction {
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
      {
        id: "write_step",
        name: "Write Result",
        type: "plugin",
        config: {
          pluginId: "file_ops",
          inputMapping: {
            operation: "file_operation",
            path: "file_path",
            content: "count_result",
          },
          outputKey: "write_result",
        },
      },
      { id: "end", name: "End", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "count_step", isConditional: false },
      { id: "e2", source: "count_step", target: "write_step", isConditional: false },
      { id: "e3", source: "write_step", target: "end", isConditional: false },
    ],
    stateSchema: {
      counter_name: { type: "string", required: true },
      action: { type: "string", required: true },
      amount: { type: "number", required: false },
      file_operation: { type: "string", required: true },
      file_path: { type: "string", required: true },
      count_result: { type: "string", required: false },
      write_result: { type: "string", required: false },
    },
  };
}

function invalidCounterActionGraph(): LangGraphAbstraction {
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

function spanishSummaryGraph(executorModel: string, provider: string, keyId?: string): LangGraphAbstraction {
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
          think: false,
          systemPrompt:
            "Resumí el texto dado en una sola oración corta, en español. Respondé únicamente con la oración, sin nada más.",
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

function summarizeThenClassifyGraph(executorModel: string, provider: string, keyId?: string): LangGraphAbstraction {
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
          think: false,
          systemPrompt:
            "Summarize the given text in a single short sentence. Reply with only the sentence, nothing else.",
          outputKey: "summary",
        },
      },
      {
        id: "classify_step",
        name: "Classify Topic",
        type: "llm",
        config: {
          model: executorModel,
          provider,
          ...(keyId ? { keyId } : {}),
          think: false,
          systemPrompt:
            "Classify the topic of the given summary as exactly one word: 'technology', 'finance', or 'nature'. Reply with only that word.",
          inputMapping: { "text to classify": "summary" },
          outputKey: "topic",
        },
      },
      { id: "end", name: "End", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "summarize_step", isConditional: false },
      { id: "e2", source: "summarize_step", target: "classify_step", isConditional: false },
      { id: "e3", source: "classify_step", target: "end", isConditional: false },
    ],
    stateSchema: {
      input: { type: "string", required: true },
      summary: { type: "string", required: false },
      topic: { type: "string", required: false },
    },
  };
}

export function buildExecutionCases(
  executorModel: string,
  provider: string,
  keyId?: string,
  tempDir?: string,
): ExecutionEvalCase[] {
  const outputFilePath = tempDir ? `${tempDir}/eval-count-result.txt` : "/tmp/eval-count-result.txt";

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
      inputState: { counter_name: "eval-pushups", action: "reset", amount: 0 },
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
      expectedResultCheck: (state) => {
        const summary = typeof state.summary === "string" ? stripThinkTags(state.summary) : "";
        return summary.length > 0 && summary.length < 300;
      },
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
      expectedResultCheck: (state) => {
        const summary = typeof state.summary === "string" ? stripThinkTags(state.summary) : "";
        return summary.length > 0 && !/^(sure|here is|here's)/i.test(summary);
      },
      expectedResultDescription: "summary does not start with a conversational preamble",
    },
    {
      name: "execution (branching): classifies a clearly positive message and takes the positive branch",
      activePlugins: [],
      inputState: { input: "This is amazing, thank you so much for your help!" },
      buildGraph: () => classifyAndBranchGraph(executorModel, provider, keyId),
      expectedResultCheck: (state) =>
        typeof state.final_reply === "string" &&
        stripThinkTags(state.final_reply) === "Thanks for the kind words!",
      expectedResultDescription: "final_reply matches the positive branch's fixed reply",
    },
    {
      name: "execution (branching): classifies a clearly negative message and takes the negative branch",
      activePlugins: [],
      inputState: { input: "This is terrible, nothing works and I'm very frustrated." },
      buildGraph: () => classifyAndBranchGraph(executorModel, provider, keyId),
      expectedResultCheck: (state) =>
        typeof state.final_reply === "string" &&
        stripThinkTags(state.final_reply) === "Sorry to hear that, let us help.",
      expectedResultDescription: "final_reply matches the negative branch's fixed reply",
    },
    {
      name: "execution (branching, español): clasifica un mensaje claramente positivo y toma la rama correcta",
      activePlugins: [],
      inputState: { input: "¡Esto es increíble, muchas gracias por tu ayuda!" },
      buildGraph: () => classifyAndBranchGraph(executorModel, provider, keyId),
      expectedResultCheck: (state) =>
        typeof state.final_reply === "string" &&
        stripThinkTags(state.final_reply) === "Thanks for the kind words!",
      expectedResultDescription: "final_reply matches the positive branch's fixed reply for Spanish input",
    },
    {
      name: "execution (multi-plugin): a counter node feeds a file_ops node in the same graph",
      activePlugins: ["counter", "file_ops"],
      inputState: {
        counter_name: "eval-multiplugin",
        action: "increment",
        amount: 3,
        file_operation: "write",
        file_path: outputFilePath,
      },
      buildGraph: counterThenFileGraph,
      expectedResultCheck: (state) =>
        typeof state.count_result === "string" &&
        state.count_result.length > 0 &&
        typeof state.write_result === "string" &&
        /wrote/i.test(state.write_result),
      expectedResultDescription:
        "count_result is populated by the counter node and write_result confirms the file_ops node wrote it to disk",
    },
    {
      name: "execution (error handling): an invalid plugin action surfaces as an error message in state, not a crash",
      activePlugins: ["counter"],
      inputState: { counter_name: "eval-pushups", action: "multiply", amount: 1 },
      buildGraph: invalidCounterActionGraph,
      expectedResultCheck: (state) =>
        typeof state.count_result === "string" &&
        state.count_result.toLowerCase().includes("error"),
      expectedResultDescription: "count_result contains an explicit error message instead of throwing",
    },
    {
      name: "execution (reasoning, español): un nodo llm resume un texto en una oración en español",
      activePlugins: [],
      inputState: {
        input:
          "El informe trimestral muestra que los ingresos crecieron un 12% interanual, impulsados principalmente por la nueva línea de productos empresariales, mientras que los costos operativos se mantuvieron estables gracias a la migración de infraestructura completada en marzo.",
      },
      buildGraph: () => spanishSummaryGraph(executorModel, provider, keyId),
      expectedResultCheck: (state) => {
        const summary = typeof state.summary === "string" ? stripThinkTags(state.summary) : "";
        return summary.length > 0 && summary.length < 300;
      },
      expectedResultDescription: "summary is a short non-empty Spanish string",
    },
    {
      name: "execution (deep graph): two chained llm nodes — summarize, then classify the summary's topic",
      activePlugins: [],
      inputState: {
        input:
          "Scientists have developed a new battery technology that charges electric vehicles in under five minutes, potentially transforming how people think about long-distance travel.",
      },
      buildGraph: () => summarizeThenClassifyGraph(executorModel, provider, keyId),
      expectedResultCheck: (state) => {
        const topic = typeof state.topic === "string" ? stripThinkTags(state.topic).toLowerCase() : "";
        const summary = typeof state.summary === "string" ? stripThinkTags(state.summary) : "";
        return summary.length > 0 && topic.includes("technology");
      },
      expectedResultDescription:
        "summary is populated by the first node and the second node classifies it as 'technology'",
    },
  ];
}
