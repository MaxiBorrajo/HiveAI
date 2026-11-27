import type { ModelRef } from "../../core/ai/providers/types.ts";
import type { FitStatus } from "../hardware/types.ts";

export const TASK_TYPES = [
  "chat",
  "code",
  "summarization",
  "documents_data",
  "reasoning",
  "vision",
  "tools",
] as const;

export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_LABELS: Record<TaskType, string> = {
  chat: "General conversation",
  code: "Code",
  summarization: "Summarization",
  documents_data: "Documents and data analysis",
  reasoning: "Complex reasoning",
  vision: "Images (vision)",
  tools: "Tool calling",
};

export function isTaskType(value: string | undefined): value is TaskType {
  return !!value && (TASK_TYPES as readonly string[]).includes(value);
}

export interface TaskScore {
  /** 0..1 affinity of this model family with the task */
  score: number;
  /** One line shown to the user: why it is recommended */
  reason: string;
}

export interface CatalogEntry {
  provider: ModelRef["provider"];
  /** Model-name prefix; the longest matching prefix wins */
  match: string;
  label?: string;
  /** Declared capabilities. Omitted = not declared (unknown) */
  capabilities?: { vision?: boolean; tools?: boolean };
  /** USD per million tokens. Omitted = looked up in the built-in price table */
  price?: { input: number; output: number };
  tasks: Partial<Record<TaskType, TaskScore>>;
  /** Local models only: what to `ollama pull` when the user has nothing suitable */
  install?: {
    ref: string;
    sizeBytes: number;
    paramsBillions: number;
    contextLength?: number;
  };
}

export interface Catalog {
  version: number;
  entries: CatalogEntry[];
  /** Task -> eval categories whose results back that task */
  evalMapping: Partial<Record<TaskType, string[]>>;
  /** Typical tokens of one request of this task, used for the cloud cost estimate */
  typicalTokens: Partial<Record<TaskType, { input: number; output: number }>>;
}

export type Support = "supported" | "unsupported" | "unknown";

/** A model the user can use right now. */
export interface Candidate {
  ref: ModelRef;
  label: string;
  location: "local" | "cloud";
  vision: Support;
  tools: Support;
  /** Local only: what the hardware check needs */
  local?: {
    sizeBytes: number;
    paramsBillions: number | null;
    contextLength: number | null;
  };
}

export interface EvalSignal {
  /** 0..1 mean of the mapped categories */
  value: number;
  lowConfidence: boolean;
}

export type RecommendationBasis = "capabilities+cost" | "capabilities+cost+evals";

export interface Recommendation {
  id: string;
  ref: ModelRef;
  label: string;
  location: "local" | "cloud";
  reason: string;
  basis: RecommendationBasis;
  score: number;
  /** Cloud only. null = price unknown */
  estimatedCostUsd?: number | null;
  fit?: { status: FitStatus; reason: string };
}

export interface NotRecommended {
  id: string;
  ref: ModelRef;
  label: string;
  location: "local" | "cloud";
  reason: string;
}

export type Suggestion =
  | { kind: "install"; model: string; reason: string }
  | { kind: "configure-cloud"; provider: ModelRef["provider"]; model: string; reason: string };

export interface RecommendationResult {
  task: TaskType;
  recommendations: Recommendation[];
  notRecommended: NotRecommended[];
  /** The catalog has no data for this task: nothing is recommended */
  noData: boolean;
  message?: string;
  suggestions: Suggestion[];
  /** Available models the catalog knows nothing about (never guessed) */
  unrated: number;
}
