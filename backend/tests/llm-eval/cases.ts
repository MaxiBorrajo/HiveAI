export type EvalCategory =
  | "routing"
  | "abstention"
  | "param-extraction"
  | "multi-turn";

export interface PriorTurn {
  role: "user" | "assistant";
  content: string;
}

export interface EvalCase {
  name: string;
  category: EvalCategory;
  query: string;
  activePlugins: string[];
  expectedTool: string | null;
  expectedParams?: Record<string, unknown>;
  /** Prior messages in the conversation, for multi-turn cases. */
  priorTurns?: PriorTurn[];
}

export const evalCases: EvalCase[] = [
  {
    name: "routing: pick counter over datetime for a tally request",
    category: "routing",
    query: "add one coffee to my coffee counter",
    activePlugins: ["counter", "current_datetime"],
    expectedTool: "counter",
  },
  {
    name: "routing: pick datetime over counter for a clock request",
    category: "routing",
    query: "what time is it right now?",
    activePlugins: ["counter", "current_datetime"],
    expectedTool: "current_datetime",
  },
  {
    name: "routing: pick counter for a 'how many' query about a tracked metric",
    category: "routing",
    query: "how many pomodoros have I logged so far?",
    activePlugins: ["counter", "current_datetime"],
    expectedTool: "counter",
  },
  {
    name: "routing: pick datetime for a 'what day' query",
    category: "routing",
    query: "what day of the week is it today?",
    activePlugins: ["counter", "current_datetime"],
    expectedTool: "current_datetime",
  },
  {
    name: "abstention: general knowledge question with no matching plugin",
    category: "abstention",
    query: "who wrote the novel 'Don Quixote'?",
    activePlugins: ["counter", "current_datetime"],
    expectedTool: null,
  },
  {
    name: "abstention: casual greeting should not trigger any tool",
    category: "abstention",
    query: "hey, how's it going?",
    activePlugins: ["counter", "current_datetime"],
    expectedTool: null,
  },
  {
    name: "abstention: plugin not active should never be selected",
    category: "abstention",
    query: "add a coffee to the counter",
    activePlugins: ["current_datetime"],
    expectedTool: null,
  },
  {
    name: "param-extraction: counter increment amount is extracted correctly",
    category: "param-extraction",
    query: "increment my pushups counter by 20",
    activePlugins: ["counter", "current_datetime"],
    expectedTool: "counter",
    expectedParams: { name: "pushups", action: "increment", amount: 20 },
  },
  {
    name: "param-extraction: counter reset action is extracted correctly",
    category: "param-extraction",
    query: "reset the glasses of water counter to zero",
    activePlugins: ["counter", "current_datetime"],
    expectedTool: "counter",
    expectedParams: { name: "glasses of water", action: "reset" },
  },
  {
    name: "param-extraction: datetime format 'date' is extracted for a date-only question",
    category: "param-extraction",
    query: "just tell me today's date, not the time",
    activePlugins: ["counter", "current_datetime"],
    expectedTool: "current_datetime",
    expectedParams: { format: "date" },
  },
  {
    name: "routing: pick file_read over web_search for a local file question",
    category: "routing",
    query: "what's inside my README.md file?",
    activePlugins: ["file_read", "web_search"],
    expectedTool: "file_read",
  },
  {
    name: "routing: pick web_search over file_read for a current-events question",
    category: "routing",
    query: "what's the latest news on the JavaScript ecosystem?",
    activePlugins: ["file_read", "web_search"],
    expectedTool: "web_search",
  },
  {
    name: "abstention: timeless knowledge question with web_search active should not trigger a search",
    category: "abstention",
    query: "what's the capital of France?",
    activePlugins: ["web_search"],
    expectedTool: null,
  },
  {
    name: "abstention: file_read not active should never be selected for a file question",
    category: "abstention",
    query: "read the contents of config.json for me",
    activePlugins: ["web_search"],
    expectedTool: null,
  },
  {
    name: "multi-turn: a follow-up pronoun ('it') resolves to the counter named earlier",
    category: "multi-turn",
    query: "now increment it by 5",
    activePlugins: ["counter", "current_datetime"],
    priorTurns: [
      { role: "user", content: "create a counter called pushups" },
      { role: "assistant", content: "Done — I created a counter named 'pushups'." },
    ],
    expectedTool: "counter",
    expectedParams: { name: "pushups", action: "increment", amount: 5 },
  },
  {
    name: "multi-turn: after an unrelated exchange, a direct datetime question still routes correctly",
    category: "multi-turn",
    query: "and what time is it now?",
    activePlugins: ["counter", "current_datetime"],
    priorTurns: [
      { role: "user", content: "hey, how's it going?" },
      { role: "assistant", content: "Doing well, how can I help?" },
    ],
    expectedTool: "current_datetime",
  },
  {
    name: "multi-turn: correction in a later turn changes the target counter",
    category: "multi-turn",
    query: "actually, make that the water counter instead",
    activePlugins: ["counter", "current_datetime"],
    priorTurns: [
      { role: "user", content: "add one to my coffee counter" },
      { role: "assistant", content: "Added one to 'coffee'. It's now at 1." },
    ],
    expectedTool: "counter",
    expectedParams: { name: "water", action: "increment" },
  },
];
