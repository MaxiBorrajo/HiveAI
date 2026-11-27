import { assert, assertEquals } from "@std/assert";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { compactToolResults } from "../../../../../core/ai/token-savings/deterministic-compaction.ts";
import {
  clearSummaryCache,
  summarizeHistory,
} from "../../../../../core/ai/token-savings/llm-summary.ts";
import { withCompactionListener } from "../../../../../core/ai/token-savings/notice.ts";
import { pickSmallModel } from "../../../../../core/ai/token-savings/small-model.ts";

const cfg = {
  compactionTriggerChars: 1_000,
  compactionMinResultChars: 100,
  keepRecentToolResults: 1,
};
const big = "x".repeat(2_000);

function loop(): [HumanMessage, ...(AIMessage | ToolMessage)[]] {
  return [
    new HumanMessage("go"),
    new AIMessage({ content: "", tool_calls: [{ id: "t1", name: "web_read", args: {} }] }),
    new ToolMessage({ content: big, tool_call_id: "t1", name: "web_read" }),
    new AIMessage({ content: "", tool_calls: [{ id: "t2", name: "web_read", args: {} }] }),
    new ToolMessage({ content: big, tool_call_id: "t2", name: "web_read" }),
  ];
}

Deno.test("compaction - old consumed tool results become markers, recent stay", () => {
  const msgs = [...loop(), new AIMessage("done")];
  const out = compactToolResults(msgs, cfg);
  const first = out[2] as ToolMessage;
  assert(String(first.content).includes("omitted"));
  assertEquals(first.tool_call_id, "t1");
  assertEquals((out[4] as ToolMessage).content, big);
});

Deno.test("compaction - results not yet consumed by the model are never touched", () => {
  const msgs = loop();
  const out = compactToolResults(msgs, { ...cfg, keepRecentToolResults: 0 });
  assertEquals((out[4] as ToolMessage).content, big);
  assert(String((out[2] as ToolMessage).content).includes("omitted"));
});

Deno.test("compaction - below the trigger returns the same array", () => {
  const msgs = loop();
  assert(compactToolResults(msgs, { ...cfg, compactionTriggerChars: 1e9 }) === msgs);
});

Deno.test("compaction - small results are kept", () => {
  const msgs = [
    new HumanMessage(big),
    new AIMessage({ content: "", tool_calls: [{ id: "a", name: "t", args: {} }] }),
    new ToolMessage({ content: "tiny", tool_call_id: "a", name: "t" }),
    new AIMessage("ok"),
  ];
  assert(compactToolResults(msgs, { ...cfg, keepRecentToolResults: 0 }) === msgs);
});

const sumCfg = { summaryTriggerChars: 500, summaryMinHistoryChars: 200 };
const history = () => [
  new SystemMessage("sys"),
  new HumanMessage("q1 " + "a".repeat(300)),
  new AIMessage("r1 " + "b".repeat(300)),
  new HumanMessage("current question"),
];

Deno.test("summary - folds old history into the current user message and notifies once", async () => {
  clearSummaryCache();
  let calls = 0;
  const notices: unknown[] = [];
  const provider = () => Promise.resolve((_: string) => {
    calls++;
    return Promise.resolve("SUMMARY");
  });
  const run = () => withCompactionListener((n) => notices.push(n), () => summarizeHistory(history(), sumCfg, provider));
  const out = await run();
  assertEquals(out.length, 2);
  assert(String(out[1].content).includes("SUMMARY"));
  assert(String(out[1].content).includes("current question"));
  await run();
  assertEquals(calls, 1);
  assertEquals(notices.length, 1);
});

Deno.test("summary - a failing summarizer throws to the caller (pipeline falls back)", async () => {
  clearSummaryCache();
  const provider = () => Promise.resolve((_: string) => Promise.reject(new Error("boom")));
  let threw = false;
  try {
    await summarizeHistory(history(), sumCfg, provider);
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("summary - no summarizer available returns messages untouched", async () => {
  const msgs = history();
  assert((await summarizeHistory(msgs, sumCfg, () => Promise.resolve(undefined))) === msgs);
});

Deno.test("summary - small histories are not summarized", async () => {
  const msgs = history();
  const out = await summarizeHistory(msgs, { ...sumCfg, summaryMinHistoryChars: 1e6 }, () => {
    throw new Error("must not be called");
  });
  assert(out === msgs);
});

Deno.test("small model - picks the newest haiku / flash and skips lite variants", () => {
  assertEquals(
    pickSmallModel("anthropic", ["claude-sonnet-5-5", "claude-haiku-4-5", "claude-haiku-5-5"]),
    "claude-haiku-5-5",
  );
  assertEquals(
    pickSmallModel("google", ["models/gemini-2.5-pro", "models/gemini-2.5-flash-lite", "models/gemini-2.5-flash"]),
    "gemini-2.5-flash",
  );
  assertEquals(pickSmallModel("anthropic", ["claude-opus-5-5"]), undefined);
});
