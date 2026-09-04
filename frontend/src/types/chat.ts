export interface ChatStep {
  node: "Selector" | "Executor" | "HiveQueen" | "Plugin";
  label: string;
  durationMs: number;
  summary: string;
}

export interface Message {
  id: string;
  role: "user" | "agent";
  content: string;
  isError?: boolean;
  timestamp: number;
  usedTools?: string[];
  steps?: ChatStep[];
}
