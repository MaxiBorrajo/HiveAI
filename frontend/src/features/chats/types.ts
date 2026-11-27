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
import type { AttachmentDto } from "./api/attachments.ts";
import type {
  Recommendation,
  Suggestion,
  TaskType,
} from "@/features/models/api/getModelRecommendations";

/** "Looks like you are doing X, try these models", shown under an assistant message. */
export interface ModelSuggestion {
  task: TaskType;
  taskLabel: string;
  recommendations: Recommendation[];
  /** Only when nothing the user has fits: what to install or configure */
  suggestions: Suggestion[];
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
  usage?: MessageUsage | null;
  attachments?: AttachmentDto[];
  modelSuggestion?: ModelSuggestion;
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
    modelSuggestion?: ModelSuggestion;
  } | null;
  usage: MessageUsage | null;
  attachments: AttachmentDto[];
}

export interface ChatSummary {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
}
