import { basename, join } from "@std/path";
import type { ModelRef } from "../../../core/ai/providers/types.ts";
import { modelRefLabel } from "../../../tests/llm-eval/model-ref.ts";
import { parseProgressLine } from "../../../tests/llm-eval/progress.ts";
import type { SuiteName } from "../../../tests/llm-eval/casesVersion.ts";

/** First argument that makes main.ts run a profile instead of the server. */
export const EVAL_PROFILE_COMMAND = "eval-profile";

const BACKEND_ROOT = join(import.meta.dirname!, "../../..");
const LOG_LINES_KEPT = 40;

export type EvalJobStatus = "running" | "succeeded" | "failed" | "cancelled";

export interface EvalJob {
  model: string;
  suites: SuiteName[];
  judge?: string;
  status: EvalJobStatus;
  startedAt: string;
  finishedAt?: string;
  /** Case currently running, from the child's progress events. */
  current?: { suite: string; index: number; total: number; name: string };
  /** Suites whose metrics are already saved in the profile. */
  savedSuites: string[];
  skipped: { suite: string; reason: string }[];
  /** Tail of the child's output, for showing why a run failed. */
  log: string[];
}

interface RunningJob {
  job: EvalJob;
  child?: Deno.ChildProcess;
}

const jobs = new Map<string, RunningJob>();

export interface StartEvalOptions {
  executor: ModelRef;
  judge?: ModelRef;
  suites: SuiteName[];
  /** A few cases per category instead of all of them. */
  quick?: boolean;
  /** The user saw the cost estimate and accepted it (cloud models). */
  confirm: boolean;
}

/** CLI args for profileModel.ts. */
export function buildProfileArgs(opts: StartEvalOptions): string[] {
  const args = [
    `--executor=${modelRefLabel(opts.executor)}`,
    `--categories=${opts.suites.join(",")}`,
  ];
  if (opts.executor.keyId) args.push(`--executor-key=${opts.executor.keyId}`);
  if (opts.judge) {
    args.push(`--judge=${modelRefLabel(opts.judge)}`);
    if (opts.judge.keyId) args.push(`--judge-key=${opts.judge.keyId}`);
  }
  if (opts.quick) args.push("--quick");
  if (opts.confirm) args.push("--confirm");
  return args;
}

/**
 * How to re-launch this app as an eval child. Under `deno run` (dev) that's
 * deno + main.ts; in the packaged desktop build the executable *is* the app,
 * so it gets the command directly.
 */
export function evalChildCommand(profileArgs: string[], execPath = Deno.execPath()): {
  command: string;
  args: string[];
} {
  const isDeno = /^deno(\.exe)?$/i.test(basename(execPath));
  return isDeno
    ? { command: execPath, args: ["run", "-A", join(BACKEND_ROOT, "main.ts"), EVAL_PROFILE_COMMAND, ...profileArgs] }
    : { command: execPath, args: [EVAL_PROFILE_COMMAND, ...profileArgs] };
}

export function getEvalJob(model: string): EvalJob | undefined {
  return jobs.get(model)?.job;
}

function pushLog(job: EvalJob, line: string) {
  job.log.push(line);
  if (job.log.length > LOG_LINES_KEPT) job.log.splice(0, job.log.length - LOG_LINES_KEPT);
}

async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  let buffer = "";
  for await (const chunk of stream.pipeThrough(new TextDecoderStream())) {
    buffer += chunk;
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() ?? "";
    yield* parts;
  }
  if (buffer) yield buffer;
}

async function pump(stream: ReadableStream<Uint8Array>, job: EvalJob) {
  for await (const line of readLines(stream)) {
    const event = parseProgressLine(line);
    if (!event) {
      if (line.trim()) pushLog(job, line);
      continue;
    }
    switch (event.type) {
      case "case-start":
        job.current = { suite: event.suite, index: event.index, total: event.total, name: event.name };
        break;
      case "suite-saved":
        job.savedSuites.push(event.suite);
        break;
      case "suite-skipped":
        job.skipped.push({ suite: event.suite, reason: event.reason });
        break;
    }
  }
}

export function startEvalJob(
  opts: StartEvalOptions,
  spawn: (command: string, args: string[]) => Deno.ChildProcess = defaultSpawn,
): EvalJob {
  const model = modelRefLabel(opts.executor);
  if (jobs.get(model)?.job.status === "running") {
    throw new Error(`An evaluation of '${model}' is already running.`);
  }

  const job: EvalJob = {
    model,
    suites: opts.suites,
    judge: opts.judge ? modelRefLabel(opts.judge) : undefined,
    status: "running",
    startedAt: new Date().toISOString(),
    savedSuites: [],
    skipped: [],
    log: [],
  };
  const { command, args } = evalChildCommand(buildProfileArgs(opts));
  const child = spawn(command, args);
  const running: RunningJob = { job, child };
  jobs.set(model, running);

  Promise.all([pump(child.stdout, job), pump(child.stderr, job), child.status]).then(
    ([, , status]) => {
      if (job.status === "running") job.status = status.success ? "succeeded" : "failed";
      job.finishedAt = new Date().toISOString();
      job.current = undefined;
      running.child = undefined;
    },
    (error) => {
      if (job.status === "running") job.status = "failed";
      pushLog(job, String(error));
      job.finishedAt = new Date().toISOString();
      running.child = undefined;
    },
  );

  return job;
}

/** Stops a running evaluation. Suites already saved stay in the profile;
 *  the one in progress is dropped, leaving its previous results intact. */
export function cancelEvalJob(model: string): EvalJob | undefined {
  const running = jobs.get(model);
  if (!running || running.job.status !== "running") return running?.job;
  running.job.status = "cancelled";
  try {
    running.child?.kill();
  } catch {
    // Already exited.
  }
  return running.job;
}

function defaultSpawn(command: string, args: string[]): Deno.ChildProcess {
  return new Deno.Command(command, {
    args,
    cwd: BACKEND_ROOT,
    env: { HIVEAI_EVAL_PROGRESS: "1" },
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
}
