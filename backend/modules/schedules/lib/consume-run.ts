export type RunOutcome =
  | { ok: true; historyId: number | null }
  | { ok: false; error: string };

/**
 * `runExecution` answers with an SSE stream (or a JSON error before it
 * starts). A scheduled run has no browser listening, so drain the stream and
 * keep only how it ended; the full trace is already persisted in the history.
 */
export async function consumeRunResponse(
  response: Response,
): Promise<RunOutcome> {
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("text/event-stream")) {
    const body = await response.json().catch(() => null) as
      | { errors?: string[] }
      | null;
    return {
      ok: false,
      error: body?.errors?.join(" ") ?? `Run failed (HTTP ${response.status})`,
    };
  }
  if (!response.body) return { ok: false, error: "The run produced no output." };

  let historyId: number | null = null;
  let error: string | null = null;
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");

      const event = /^event: (.*)$/m.exec(block)?.[1];
      if (event !== "done" && event !== "error") continue;
      const data = /^data: (.*)$/m.exec(block)?.[1];
      try {
        const parsed = JSON.parse(data ?? "{}");
        if (event === "done") historyId = parsed.historyId ?? null;
        else error = parsed.message ?? "The run failed.";
      } catch {
        if (event === "error") error = "The run failed.";
      }
    }
  }

  if (error) return { ok: false, error };
  if (historyId === null) {
    return { ok: false, error: "The run ended without saving a result." };
  }
  return { ok: true, historyId };
}
