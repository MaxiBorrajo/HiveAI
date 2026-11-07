import { ResponseBuilder } from "../../../core/api/response.ts";
import { saveToDownloads } from "../../../core/files/save-to-downloads.ts";
import { isCloudProvider, isModelProvider, type ModelRef } from "../../../core/ai/providers/types.ts";
import { modelRefLabel, ollamaModelDigest } from "../../../tests/llm-eval/model-ref.ts";
import {
  estimateRun,
  loadProfile,
  modelFileSafe,
  profileStatus,
  type MetricStatus,
  type ModelProfile,
  type RunEstimate,
} from "../../../tests/llm-eval/profile.ts";
import {
  ALL_SUITES,
  allCasesVersions,
  SUITE_CATEGORIES,
  type SuiteName,
} from "../../../tests/llm-eval/casesVersion.ts";
import { JUDGED_SUITES, judgeProblem } from "../../../tests/llm-eval/suites.ts";
import {
  buildProfileExport,
  profileExportToHtml,
  profileExportToMarkdown,
} from "../../../tests/llm-eval/profileReport.ts";
import { cancelEvalJob, getEvalJob, startEvalJob, type EvalJob } from "./eval-profile-jobs.ts";

// Profiles are built by the eval runner (tests/llm-eval/profileModel.ts) —
// from the CLI, or from the app via eval-profile-jobs.ts, which runs it in a
// child process. This module only reads them and starts/stops those runs.

export interface ModelEvalProfileResponse {
  profile: ModelProfile;
  status: Record<string, MetricStatus>;
  job?: EvalJob;
  /** Suites that can be chosen, with the metrics each one produces. */
  suites: { suite: SuiteName; categories: string[]; needsJudge: boolean }[];
}

async function currentVersions(model: string) {
  const suiteVersions = await allCasesVersions();
  const casesVersions: Record<string, string> = {};
  for (const s of ALL_SUITES) {
    for (const c of SUITE_CATEGORIES[s]) casesVersions[c] = suiteVersions[s];
  }
  // Only Ollama models carry a digest; a cloud model id pins its own version.
  const [prefix] = model.split(":");
  const cloud = isModelProvider(prefix) && isCloudProvider(prefix);
  return { casesVersions, modelVersion: cloud ? undefined : await ollamaModelDigest(model) };
}

export async function fetchModelEvalProfile(model: string): Promise<ModelEvalProfileResponse> {
  const profile = await loadProfile(modelFileSafe(model), model);
  return {
    profile,
    status: profileStatus(profile, await currentVersions(model)),
    job: getEvalJob(model),
    suites: ALL_SUITES.map((suite) => ({
      suite,
      categories: SUITE_CATEGORIES[suite],
      needsJudge: JUDGED_SUITES.includes(suite),
    })),
  };
}

/** Always 200: a model never profiled gets an empty profile, not an error. */
export async function getModelEvalProfile(
  model: string,
  headers: Record<string, string>,
): Promise<Response> {
  return ResponseBuilder.success(await fetchModelEvalProfile(model), { headers });
}

// --- run requests ------------------------------------------------------------

export interface EvalRunRequest {
  executor: ModelRef;
  judge?: ModelRef;
  suites: SuiteName[];
  confirm?: boolean;
}

function parseRef(raw: unknown): ModelRef | undefined {
  const r = raw as Partial<ModelRef> | undefined;
  if (!r || typeof r.model !== "string" || !r.model || !isModelProvider(String(r.provider))) {
    return undefined;
  }
  return { provider: r.provider!, model: r.model, keyId: r.keyId || undefined };
}

/** Validates a run request body; returns the problems found, if any. */
export function parseEvalRunRequest(body: unknown): { request?: EvalRunRequest; errors: string[] } {
  const b = (body ?? {}) as Record<string, unknown>;
  const executor = parseRef(b.executor);
  const judge = b.judge ? parseRef(b.judge) : undefined;
  const suites = Array.isArray(b.suites) ? (b.suites as string[]) : [];

  const errors: string[] = [];
  if (!executor) errors.push("A valid executor model is required.");
  if (b.judge && !judge) errors.push("The judge model is invalid.");
  if (suites.length === 0) errors.push("Choose at least one category to evaluate.");
  const unknown = suites.filter((s) => !ALL_SUITES.includes(s as SuiteName));
  if (unknown.length > 0) errors.push(`Unknown categories: ${unknown.join(", ")}.`);
  if (executor && suites.some((s) => JUDGED_SUITES.includes(s as SuiteName))) {
    const problem = judgeProblem(executor, judge);
    if (problem) errors.push(`The judged categories need an independent judge: ${problem}.`);
  }

  if (errors.length > 0) return { errors };
  return {
    request: { executor: executor!, judge, suites: suites as SuiteName[], confirm: b.confirm === true },
    errors,
  };
}

export async function estimateEvalRun(request: EvalRunRequest): Promise<RunEstimate> {
  const label = modelRefLabel(request.executor);
  const profile = await loadProfile(modelFileSafe(label), label);
  return estimateRun(request.executor, request.judge, request.suites, profile, JUDGED_SUITES);
}

export async function handleEstimateEvalRun(body: unknown, headers: Record<string, string>) {
  const { request, errors } = parseEvalRunRequest(body);
  if (!request) return ResponseBuilder.error(errors, undefined, { status: 400, headers });
  return ResponseBuilder.success(await estimateEvalRun(request), { headers });
}

export async function handleStartEvalRun(body: unknown, headers: Record<string, string>) {
  const { request, errors } = parseEvalRunRequest(body);
  if (!request) return ResponseBuilder.error(errors, undefined, { status: 400, headers });

  const estimate = await estimateEvalRun(request);
  if (estimate.requiresConfirmation && !request.confirm) {
    return ResponseBuilder.error(
      ["This run uses a cloud model and costs money; confirm the estimate first."],
      estimate,
      { status: 409, headers },
    );
  }

  try {
    const job = startEvalJob({ ...request, confirm: request.confirm ?? false });
    return ResponseBuilder.success(job, { status: 202, headers });
  } catch (error) {
    return ResponseBuilder.error([error instanceof Error ? error.message : String(error)], undefined, {
      status: 409,
      headers,
    });
  }
}

export function handleCancelEvalRun(model: string, headers: Record<string, string>) {
  const job = cancelEvalJob(model);
  if (!job) {
    return ResponseBuilder.error(["No evaluation is running for this model."], undefined, { status: 404, headers });
  }
  return ResponseBuilder.success(job, { headers });
}

// --- export ------------------------------------------------------------------

const EXPORT_FORMATS = ["json", "md", "html"] as const;
type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** The profile plus the full results of the runs behind it, as a file. */
export async function buildProfileExportFile(
  model: string,
  format: ExportFormat,
): Promise<{ filename: string; body: string }> {
  const { profile, status } = await fetchModelEvalProfile(model);
  const exp = await buildProfileExport(profile, status);
  const body = format === "json"
    ? JSON.stringify(exp, null, 2)
    : format === "md"
    ? profileExportToMarkdown(exp)
    : profileExportToHtml(exp);
  return { filename: `${modelFileSafe(model)}-eval-profile.${format}`, body };
}

/** Saves the export to the user's Downloads folder (the desktop webview
 *  can't do browser downloads) and returns where it went. */
export async function handleExportEvalProfile(
  model: string,
  format: string,
  headers: Record<string, string>,
): Promise<Response> {
  if (!EXPORT_FORMATS.includes(format as ExportFormat)) {
    return ResponseBuilder.error([`Unknown format '${format}'. Use json, md or html.`], undefined, {
      status: 400,
      headers,
    });
  }
  const { filename, body } = await buildProfileExportFile(model, format as ExportFormat);
  const path = await saveToDownloads(filename, body);
  return ResponseBuilder.success({ path }, { headers });
}
