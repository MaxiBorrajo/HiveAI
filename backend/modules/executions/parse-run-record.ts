import type { RunInfo } from "../usage/run-info.ts";
import { parseMaybeJson } from "./parse-maybe-json.ts";

export interface ParsedRunRecord {
  result: unknown;
  finalState: unknown;
  // Absent for runs saved before runs recorded their models and timing.
  run: RunInfo | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// A run's result is stored as JSON text. Older rows hold the bare result (no
// `result` / `finalState` keys), and none of them has `run`.
export function parseRunRecord(raw: unknown): ParsedRunRecord {
  const parsed = parseMaybeJson(raw);
  if (!isObject(parsed)) return { result: parsed, finalState: undefined, run: null };

  const hasEnvelope = "result" in parsed || "finalState" in parsed;
  const run = isObject(parsed.run) && Array.isArray(parsed.run.nodes)
    ? (parsed.run as unknown as RunInfo)
    : null;

  return {
    result: hasEnvelope ? parsed.result : parsed,
    finalState: hasEnvelope ? parsed.finalState : undefined,
    run,
  };
}
