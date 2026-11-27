import { assertEquals } from "@std/assert";
import { consumeRunResponse } from "../../../../modules/schedules/lib/consume-run.ts";

const sse = (...events: [string, unknown][]) =>
  new Response(
    events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } },
  );

Deno.test("a finished run yields its history id", async () => {
  const outcome = await consumeRunResponse(sse(
    ["on_chain_start", { big: "x".repeat(10_000) }],
    ["done", { historyId: 7 }],
  ));
  assertEquals(outcome, { ok: true, historyId: 7 });
});

Deno.test("an error event fails the run even if nothing else follows", async () => {
  assertEquals(
    await consumeRunResponse(sse(["error", { message: "model offline" }])),
    { ok: false, error: "model offline" },
  );
});

Deno.test("a JSON error before the stream starts is surfaced", async () => {
  const res = Response.json({ success: false, errors: ["Missing plugins", "x"] }, { status: 422 });
  assertEquals(await consumeRunResponse(res), { ok: false, error: "Missing plugins x" });
});

Deno.test("a stream with no result is a failure, not a silent success", async () => {
  const outcome = await consumeRunResponse(sse(["on_chain_start", {}]));
  assertEquals(outcome.ok, false);
});
