export interface GeneratorEvalCase {
  name: string;
  /** User objective passed verbatim to generateIncrementalGraph. */
  prompt: string;
  /** Plugin names that must be registered/active for this case. */
  activePlugins: string[];
  /** Node types expected to appear at least once in the generated graph (besides start/end). */
  expectedNodeTypes?: Array<"llm" | "plugin" | "condition">;
  /** Minimum number of intermediate (non start/end) nodes expected. */
  minIntermediateNodes?: number;
}

export const generatorEvalCases: GeneratorEvalCase[] = [
  {
    name: "simple single-tool task: look up the current time",
    prompt: "Tell me what time it is right now.",
    activePlugins: ["current_datetime"],
    expectedNodeTypes: ["llm"],
    minIntermediateNodes: 1,
  },
  {
    name: "search-then-summarize: requires an agentic llm node, not a bare plugin node",
    prompt:
      "Search the web for the latest news about renewable energy and write a short summary.",
    activePlugins: ["web_search"],
    expectedNodeTypes: ["llm"],
    minIntermediateNodes: 1,
  },
  {
    name: "search, extract, then save: two cognitive steps across a tool fetch and a file write",
    prompt:
      "Search the web for the current Bitcoin price, extract just the number, and save it to a file called btc_price.txt.",
    activePlugins: ["web_search", "file_ops"],
    expectedNodeTypes: ["llm", "plugin"],
    minIntermediateNodes: 2,
  },
  {
    name: "conditional branching: a numeric quality gate with a loop-back",
    prompt:
      "Draft a short product description, rate its quality from 1-10 as quality_score; if quality_score is 8 or higher, save it to a file and finish, otherwise rewrite it and check again.",
    activePlugins: ["file_ops"],
    expectedNodeTypes: ["llm", "condition"],
    minIntermediateNodes: 3,
  },
  {
    name: "explicit 'agent' wording forces an llm node even for a single tool",
    prompt: "Use an agent equipped with web_search to find today's top headline.",
    activePlugins: ["web_search"],
    expectedNodeTypes: ["llm"],
    minIntermediateNodes: 1,
  },
];
