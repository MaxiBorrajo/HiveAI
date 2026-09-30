export type EvalCategory =
  | "routing" // picks the right plugin among several active ones
  | "abstention" // correctly calls no plugin when none applies
  | "param-extraction"; // picks the right plugin AND extracts correct params

export interface EvalCase {
  name: string;
  category: EvalCategory;
  query: string;
  /** Plugin names that should be active for this case. */
  activePlugins: string[];
  /** Expected tool name, or null if no tool should be called. */
  expectedTool: string | null;
  /** Subset of expected params, checked only for param-extraction cases. */
  expectedParams?: Record<string, unknown>;
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
    activePlugins: ["current_datetime"], // counter intentionally NOT active
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
];
