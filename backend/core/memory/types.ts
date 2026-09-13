export interface ThinkingRun {
  node: string | undefined;
  text: string;
}

export interface ChatStepMetadata {
  usedTools: string[];
  steps: unknown[];
  thinkingRuns?: ThinkingRun[];
}

export interface ChatRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export type MessageRole = "user" | "agent";

export interface MessageRecord {
  id: string;
  chatId: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  vector: number[];
  metadata: ChatStepMetadata | null;
}
