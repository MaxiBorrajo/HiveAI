/**
 * Progress events for an eval run. Always logged for a person watching the
 * terminal; when the run was started by the app (it sets
 * HIVEAI_EVAL_PROGRESS=1 on the child process), each event is also printed
 * as a single `@@progress {json}` line the app parses to show progress.
 */
export type ProgressEvent =
  | { type: "suite-start"; suite: string; total: number }
  | { type: "case-start"; suite: string; index: number; total: number; name: string }
  | { type: "suite-saved"; suite: string }
  | { type: "suite-skipped"; suite: string; reason: string };

export const PROGRESS_PREFIX = "@@progress ";

function structured(): boolean {
  try {
    return Deno.env.get("HIVEAI_EVAL_PROGRESS") === "1";
  } catch {
    return false;
  }
}

export function reportProgress(event: ProgressEvent): void {
  if (structured()) console.log(PROGRESS_PREFIX + JSON.stringify(event));
}

export function reportCaseStart(suite: string, index: number, total: number, name: string): void {
  console.log(`Running: ${name}`);
  reportProgress({ type: "case-start", suite, index, total, name });
}

export function parseProgressLine(line: string): ProgressEvent | undefined {
  if (!line.startsWith(PROGRESS_PREFIX)) return undefined;
  try {
    return JSON.parse(line.slice(PROGRESS_PREFIX.length)) as ProgressEvent;
  } catch {
    return undefined;
  }
}
