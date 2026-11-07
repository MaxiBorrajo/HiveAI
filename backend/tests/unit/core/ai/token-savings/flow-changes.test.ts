import { assert, assertEquals } from "@std/assert";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import {
  buildPromptMessages,
  executeLlmNode,
} from "../../../../../core/ai/visual-builder/execution/llm-executor.ts";
import type { ToolProvider } from "../../../../../core/ai/visual-builder/types.ts";
import {
  boundHistoryForCloud,
  trimOldAssistantMessages,
} from "../../../../../core/ai/token-savings/bounded-history.ts";
import { setTokenSavingsDefaults } from "../../../../../core/ai/token-savings/config.ts";
import { resolveAuxiliaryModelRef } from "../../../../../core/ai/providers/create-chat-model.ts";
import { stripThinkingBlocks } from "../../../../../core/ai/providers/thinking.ts";
import { estimateToolTokens } from "../../../../../modules/hardware/lib/plugin-context-cost.ts";

function scriptedLlm(replies: AIMessage[], seen: unknown[][] = []) {
  let i = 0;
  const model = {
    invoke: (messages: unknown[]) => {
      seen.push(messages);
      return Promise.resolve(replies[Math.min(i++, replies.length - 1)]);
    },
    bindTools: () => model,
    withStructuredOutput: () => model,
  };
  return model;
}

function countingTools(counts: Record<string, number>): ToolProvider {
  return {
    getTool: (name: string) => ({
      name,
      invoke: () => {
        counts[name] = (counts[name] ?? 0) + 1;
        return Promise.resolve("ok");
      },
    // deno-lint-ignore no-explicit-any
    }) as any,
  };
}

const repeatCall = (id: string) =>
  new AIMessage({ content: "", tool_calls: [{ name: "web_read", args: { url: "u" }, id }] });

Deno.test("executions - an identical tool call repeated in one node run is not executed twice", async () => {
  const counts: Record<string, number> = {};
  const seen: unknown[][] = [];
  const out = await executeLlmNode(
    "n",
    { model: "m", plugins: ["web_read"], outputKey: "r" },
    {},
    countingTools(counts),
    () => scriptedLlm([repeatCall("a"), repeatCall("b"), new AIMessage("done")], seen),
  );
  assertEquals(out.r, "done");
  assertEquals(counts.web_read, 1);
  assert(JSON.stringify(seen.at(-1)).includes("already ran successfully"));
});

Deno.test("executions - dedupToolCalls:false keeps the previous behavior", async () => {
  const counts: Record<string, number> = {};
  setTokenSavingsDefaults({ dedupToolCalls: false });
  try {
    await executeLlmNode(
      "n",
      { model: "m", plugins: ["web_read"], outputKey: "r" },
      {},
      countingTools(counts),
      () => scriptedLlm([repeatCall("a"), repeatCall("b"), new AIMessage("done")]),
    );
  } finally {
    setTokenSavingsDefaults(undefined);
  }
  assertEquals(counts.web_read, 2);
});

Deno.test("replay - state.messages beyond the cap keep system messages and the newest ones", () => {
  const messages = [
    { role: "system", content: "SYS" },
    ...Array.from({ length: 100 }, (_, i) => ({ role: "user", content: `m${i}` })),
  ];
  const built = buildPromptMessages({ messages }, {});
  const text = built.map((m) => String(m.content)).join("|");
  assert(text.includes("SYS"));
  assert(text.includes("m99"));
  assert(!text.includes("|m0|"));
  assert(built.length <= 41 + 1);
});

Deno.test("replay - boundedReplay:false replays everything", () => {
  setTokenSavingsDefaults({ boundedReplay: false });
  try {
    const messages = Array.from({ length: 100 }, (_, i) => ({ role: "user", content: `m${i}` }));
    assertEquals(buildPromptMessages({ messages }, {}).length, 100);
  } finally {
    setTokenSavingsDefaults(undefined);
  }
});

Deno.test("history - long older assistant replies are trimmed, recent ones and users stay", () => {
  const long = "w".repeat(20_000);
  const msgs = [
    new HumanMessage(long),
    new AIMessage(long),
    new HumanMessage("q"),
    new AIMessage("a"),
    new HumanMessage("q"),
    new AIMessage(long),
  ];
  const out = trimOldAssistantMessages(msgs, { keepRecent: 2, maxChars: 1_000 });
  assert(String(out[1].content).length < 1_200);
  assert(String(out[1].content).includes("omitted"));
  assertEquals(out[0].content, long);
  assertEquals(out[5].content, long);
});

Deno.test("history - local providers and a disabled flag leave the history untouched", () => {
  const msgs = [new AIMessage("z".repeat(50_000)), new HumanMessage("a"), new AIMessage("b"), new HumanMessage("c"), new AIMessage("d"), new HumanMessage("e")];
  assert(boundHistoryForCloud(msgs, "ollama") === msgs);
  setTokenSavingsDefaults({ boundedReplay: false });
  try {
    assert(boundHistoryForCloud(msgs, "anthropic") === msgs);
  } finally {
    setTokenSavingsDefaults(undefined);
  }
  assert(boundHistoryForCloud(msgs, "anthropic") !== msgs);
});

Deno.test("aux model - local models and disabled flag keep the same ref; failures fall back", async () => {
  const local = { provider: "ollama", model: "llama3" } as const;
  assert((await resolveAuxiliaryModelRef(local)) === local);
  const cloud = { provider: "anthropic", model: "claude-opus-5-5", keyId: "k" } as const;
  assert((await resolveAuxiliaryModelRef(cloud, { smallModelForAux: false })) === cloud);
  const failing = await resolveAuxiliaryModelRef(cloud, undefined, () => Promise.reject(new Error("x")));
  assertEquals(failing, cloud);
});

Deno.test("thinking - stripThinkingBlocks removes signed thinking blocks only", () => {
  const msg = new AIMessage({
    content: [
      { type: "thinking", thinking: "t", signature: "s" },
      { type: "text", text: "hello" },
    ],
  });
  const [out] = stripThinkingBlocks([msg]);
  assertEquals(out.content, [{ type: "text", text: "hello" }]);
});

Deno.test("static context - the trimmed tool descriptions stay within their budget", async () => {
  for (const name of ["run-shell", "web-read", "web-search", "file-search"]) {
    const mod = await import(`../../../../../plugins/${name}/index.ts`);
    const plugin = new mod.default();
    assert(plugin.description.length <= 650, `${name} description is ${plugin.description.length} chars`);
    assert(estimateToolTokens(plugin) < 450, `${name} costs too many tokens`);
  }
});
