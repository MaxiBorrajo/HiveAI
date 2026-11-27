import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import type { ModelChoice } from "../lib/modelChoices";

export type ProfileLevel = "very-good" | "good" | "fair" | "poor";

export type EvalSuite = "routing" | "generation" | "execution" | "summarization";

export interface MetricResult {
  category: string;
  value: number;
  /** Where the true value lies with 95% confidence; absent in old profiles. */
  interval?: { low: number; high: number };
  level: ProfileLevel;
  casesGraded: number;
  casesUnjudged: number;
  lowConfidence: boolean;
  date: string;
  casesVersion: string;
  judgeModel?: string;
  rubricVersion?: string;
  modelVersion?: string;
  runId?: string;
  /** Graded on a few cases per category (quick mode). */
  quick?: boolean;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  costUsd?: number | null;
  judgeCostUsd?: number | null;
}

export interface ModelEvalProfile {
  model: string;
  latest: Record<string, MetricResult>;
  history: Record<string, MetricResult[]>;
}

export interface MetricStatus {
  stale: boolean;
  reasons: string[];
  judgeChangedSincePrevious: boolean;
}

export type EvalJobStatus = "running" | "succeeded" | "failed" | "cancelled";

export interface EvalJob {
  model: string;
  suites: EvalSuite[];
  judge?: string;
  status: EvalJobStatus;
  startedAt: string;
  finishedAt?: string;
  current?: { suite: string; index: number; total: number; name: string };
  savedSuites: string[];
  skipped: { suite: string; reason: string }[];
  log: string[];
}

export interface ModelEvalProfileResponse {
  profile: ModelEvalProfile;
  status: Record<string, MetricStatus>;
  job?: EvalJob;
  suites: { suite: EvalSuite; categories: string[]; needsJudge: boolean }[];
}

export interface SuiteEstimate {
  suite: EvalSuite;
  cases: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  judgeCostUsd: number | null;
  basedOn: "history" | "defaults";
}

export interface RunEstimate {
  suites: SuiteEstimate[];
  totalCostUsd: number | null;
  requiresConfirmation: boolean;
}

export interface EvalRunRequest {
  executor: ModelChoice;
  judge?: ModelChoice;
  suites: EvalSuite[];
  /** A few cases per category instead of all of them. */
  quick?: boolean;
  confirm?: boolean;
}

/** The name a profile is stored under: "qwen3:8b" or "anthropic:claude-…". */
export function profileName(choice: Pick<ModelChoice, "provider" | "model">): string {
  return choice.provider === "ollama" ? choice.model : `${choice.provider}:${choice.model}`;
}

function base(choice: Pick<ModelChoice, "provider" | "model">) {
  return `/api/models/${encodeURIComponent(profileName(choice))}/eval-profile`;
}

function toRef(choice: ModelChoice) {
  return { provider: choice.provider, model: choice.model, keyId: choice.keyId || undefined };
}

function toBody(request: EvalRunRequest) {
  return {
    executor: toRef(request.executor),
    judge: request.judge ? toRef(request.judge) : undefined,
    suites: request.suites,
    quick: request.quick,
    confirm: request.confirm,
  };
}

/** A model never evaluated comes back with an empty profile. */
export async function getModelEvalProfile(
  choice: Pick<ModelChoice, "provider" | "model">,
): Promise<ModelEvalProfileResponse | null> {
  const response = await apiClient.get<ResponseEntity<ModelEvalProfileResponse>>(base(choice), {
    silenceErrorToast: true,
  });
  return response.data.data ?? null;
}

export async function estimateEvalRun(request: EvalRunRequest): Promise<RunEstimate | null> {
  const response = await apiClient.post<ResponseEntity<RunEstimate>>(
    `${base(request.executor)}/estimate`,
    toBody(request),
  );
  return response.data.data ?? null;
}

export async function startEvalRun(request: EvalRunRequest): Promise<EvalJob | null> {
  const response = await apiClient.post<ResponseEntity<EvalJob>>(`${base(request.executor)}/run`, toBody(request));
  return response.data.data ?? null;
}

export async function cancelEvalRun(choice: Pick<ModelChoice, "provider" | "model">): Promise<void> {
  await apiClient.delete(`${base(choice)}/run`);
}

/** Saves the profile with its results to Downloads; returns the file path. */
export async function exportEvalProfile(
  choice: Pick<ModelChoice, "provider" | "model">,
  format: "md" | "html" | "json",
): Promise<string | undefined> {
  const response = await apiClient.post<ResponseEntity<{ path: string }>>(`${base(choice)}/export`, undefined, {
    params: { format },
  });
  return response.data.data?.path;
}
