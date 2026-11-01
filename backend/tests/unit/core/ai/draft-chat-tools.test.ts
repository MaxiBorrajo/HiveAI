import { assertEquals } from "@std/assert";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { answerWithTools } from "../../../../core/ai/draft-chat/draft-chat.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

function fakeModel(replies: AIMessage[], bound: { tools: number }): Any {
  let i = 0;
  const model = {
    bindTools(tools: unknown[]) {
      bound.tools = tools.length;
      return model;
    },
    invoke() {
      return Promise.resolve(replies[Math.min(i++, replies.length - 1)]);
    },
  };
  return model;
}

async function run(gen: AsyncGenerator<Any, string>) {
  const events: Any[] = [];
  let r = await gen.next();
  while (!r.done) {
    events.push(r.value);
    r = await gen.next();
  }
  return { events, text: r.value };
}

Deno.test("runs requested tools, feeds results back and returns the final answer", async () => {
  const bound = { tools: 0 };
  const model = fakeModel([
    new AIMessage({ content: "", tool_calls: [{ name: "web_search", args: { query: "slack webhook" }, id: "1" }] }),
    new AIMessage("SUMMARY: done\n```typescript\nexport default class X {}\n```"),
  ], bound);
  const tool = { name: "web_search", invoke: (a: Any) => Promise.resolve(`results for ${a.query}`) };
  const messages = [new HumanMessage("make a plugin")];

  const { events, text } = await run(answerWithTools(model, [tool as Any], messages));

  assertEquals(bound.tools, 1);
  assertEquals(events.map((e) => e.type), ["tool_call", "tool_result"]);
  assertEquals(events[1].ok, true);
  assertEquals(events[1].output, "results for slack webhook");
  assertEquals(text.startsWith("SUMMARY: done"), true);
  // assistant tool call + tool message were appended for the next round
  assertEquals(messages.length, 3);
});

Deno.test("a failing or unknown tool is reported to the model instead of aborting", async () => {
  const model = fakeModel([
    new AIMessage({ content: "", tool_calls: [
      { name: "boom", args: {}, id: "1" },
      { name: "nope", args: {}, id: "2" },
    ] }),
    new AIMessage("final"),
  ], { tools: 0 });
  const boom = { name: "boom", invoke: () => Promise.reject(new Error("offline")) };

  const { events, text } = await run(answerWithTools(model, [boom as Any], [new HumanMessage("x")]));

  const results = events.filter((e) => e.type === "tool_result");
  assertEquals(results.map((e) => e.ok), [false, false]);
  assertEquals(results[0].output.includes("offline"), true);
  assertEquals(text, "final");
});

Deno.test("a model that rejects tools falls back to a plain answer", async () => {
  const model: Any = {
    bindTools() {
      return { invoke: () => Promise.reject(new Error("tools not supported")) };
    },
    invoke: () => Promise.resolve(new AIMessage("plain answer")),
  };
  const { events, text } = await run(
    answerWithTools(model, [{ name: "t", invoke: () => Promise.resolve("") } as Any], [new HumanMessage("x")]),
  );
  assertEquals(text, "plain answer");
  assertEquals(events[0].type, "thinking");
});

Deno.test("without tools it just answers", async () => {
  const bound = { tools: -1 };
  const { events, text } = await run(
    answerWithTools(fakeModel([new AIMessage("hi")], bound), [], [new HumanMessage("x")]),
  );
  assertEquals(events, []);
  assertEquals(text, "hi");
  assertEquals(bound.tools, -1);
});
