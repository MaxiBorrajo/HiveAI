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

export type {
  ConversationUsage,
  MessageUsage,
  ModelTotals,
  TokenTotals,
  UsageBucket,
  UsageLocation,
  UsedModel,
} from "@/lib/usage";
import type { MessageUsage } from "@/lib/usage";

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
  // undefined: the response is still streaming. null: no usage was recorded
  // for it (it predates usage tracking), shown as "—".
  usage?: MessageUsage | null;
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
  usage: MessageUsage | null;
}

export interface ChatSummary {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
}
