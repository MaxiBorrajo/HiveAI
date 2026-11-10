import type { ModelChoice } from "../lib/modelChoices";

export type TaskType =
  | "chat"
  | "code"
  | "summarization"
  | "documents_data"
  | "reasoning"
  | "vision"
  | "tools";

export interface ModelRefDto {
  provider: ModelChoice["provider"];
  model: string;
  keyId?: string;
}

export interface Recommendation {
  id: string;
  ref: ModelRefDto;
  label: string;
  location: "local" | "cloud";
  reason: string;
  basis: "capabilities+cost" | "capabilities+cost+evals";
  score: number;
  /** Cloud only; null = price unknown */
  estimatedCostUsd?: number | null;
  fit?: { status: "fits" | "slow" | "no_fit"; reason: string };
}

export interface NotRecommended {
  id: string;
  ref: ModelRefDto;
  label: string;
  location: "local" | "cloud";
  reason: string;
}

export type Suggestion =
  | { kind: "install"; model: string; reason: string }
  | { kind: "configure-cloud"; provider: string; model: string; reason: string };

export interface RecommendationResult {
  task: TaskType;
  recommendations: Recommendation[];
  notRecommended: NotRecommended[];
  noData: boolean;
  message?: string;
  suggestions: Suggestion[];
  unrated: number;
}

export function formatCostEstimate(cost: number | null | undefined): string {
  if (cost === null || cost === undefined) return "cost unknown";
  return cost < 0.01 ? `~$${cost.toFixed(4)} / request` : `~$${cost.toFixed(2)} / request`;
}
