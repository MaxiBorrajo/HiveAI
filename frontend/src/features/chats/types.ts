export interface ChatStep {
  node:
    | "Solver"
    | "AbstentionVerificator"
    | "Executor"
    | "Diagnostician"
    | "HiveQueenResponder"
    | "Plugin"
    | "Agent";
  label: string;
  durationMs: number;
  summary: string;
}

export interface ThinkingRun {
  node: string | undefined;
  text: string;
}

export interface Message {
  id: string;
  role: "user" | "agent";
  content: string;
  isError?: boolean;
  wasStopped?: boolean;
  timestamp: number;
  usedTools?: string[];
  steps?: ChatStep[];
  thinkingRuns?: ThinkingRun[];
}


export interface StoredMessage {
  id: string;
  chatId: string;
  role: "user" | "agent";
  content: string;
  timestamp: number;
  metadata: {
    usedTools: string[];
    steps: ChatStep[];
    thinkingRuns?: ThinkingRun[];
    wasStopped?: boolean;
  } | null;
}

export interface ChatSummary {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
}
