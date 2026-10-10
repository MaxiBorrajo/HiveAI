import { assertEquals } from "@std/assert";
import {
  buildStateSchema,
  compileGraph,
} from "../../../../../core/ai/visual-builder/execution/compiler.ts";
import type { LangGraphAbstraction } from "../../../../../core/ai/visual-builder/types.ts";
import { withUsageContext } from "../../../../../core/ai/usage/usage-context.ts";
import { setUsageRecorder } from "../../../../../core/ai/usage/usage-recorder.ts";
import { setKeyAliasResolver, setSecretResolver } from "../../../../../core/ai/providers/create-chat-model.ts";
import { initORM } from "../../../../../infrastructure/db/orm.ts";
import { ModelUsageRepository } from "../../../../../infrastructure/db/repositories/model-usage-repository.ts";
import { ExecutionRepository } from "../../../../../infrastructure/db/repositories/execution-repository.ts";

// A graph run through the real compiler, the real llm node and the real
// factory, against fake provider endpoints: what lands in the table is what
// the run actually did.
function fakeProviders(): typeof fetch {
  return ((input: Request | string | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/api/show")) {
      return Promise.resolve(Response.json({ model_info: {} }));
    }
    if (url.includes("/api/chat")) {
      const lines = [
        { model: "m", message: { role: "assistant", content: "ok" }, done: false },
        {
          model: "m",
          message: { role: "assistant", content: "" },
          done: true,
          done_reason: "stop",
          prompt_eval_count: 40,
          eval_count: 6,
        },
      ];
      return Promise.resolve(
        new Response(lines.map((l) => JSON.stringify(l)).join("\n") + "\n"),
      );
    }
    if (typeof init?.body === "string" && init.body.includes('"stream":true')) {
      const events = [
        ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-4-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 50, output_tokens: 0 } } }],
        ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
        ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } }],
        ["content_block_stop", { type: "content_block_stop", index: 0 }],
        ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 9 } }],
        ["message_stop", { type: "message_stop" }],
      ];
      const body = events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");
      return Promise.resolve(new Response(body, { headers: { "content-type": "text/event-stream" } }));
    }
    return Promise.resolve(Response.json({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-5",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 50, output_tokens: 9 },
    }));
  }) as typeof fetch;
}

function graphWith(
  config: Record<string, unknown>,
): LangGraphAbstraction {
  return {
    nodes: [
      { id: "start", name: "Start", type: "start", config: {} },
      {
        id: "writer",
        name: "Writer",
        type: "llm",
        config: { systemPrompt: "Say ok.", outputKey: "answer", ...config },
      },
      { id: "end", name: "End", type: "end", config: {} },
    ],
    edges: [
      { id: "e1", source: "start", target: "writer", isConditional: false },
      { id: "e2", source: "writer", target: "end", isConditional: false },
    ],
    stateSchema: {
      input: { type: "string", required: false },
      answer: { type: "string", required: false },
    },
  };
}

async function runGraph(graph: LangGraphAbstraction, executionId: number) {
  const app = compileGraph(graph, buildStateSchema(graph.stateSchema), {});
  return await withUsageContext(
    { kind: "execution", role: "delegate", executionId },
    async (groupId) => {
      const events = await app.streamEvents({ input: "go" }, { version: "v2" });
      for await (const _ of events) { /* drain */ }
      return groupId;
    },
  );
}

Deno.test("running a graph records each node's call, local and cloud, in one group", async () => {
  const db = await initORM(await Deno.makeTempDir());
  const usage = new ModelUsageRepository(db);
  const execution = await new ExecutionRepository(db).create({
    name: "usage-run",
    createdAt: 1,
    updatedAt: 1,
  });
  setUsageRecorder(usage);
  setSecretResolver(() => Promise.resolve("sk-test"));
  setKeyAliasResolver((id) => Promise.resolve(id === "k-work" ? "work" : undefined));
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeProviders();
  try {
    const localGroup = await runGraph(
      graphWith({ model: "llama3", provider: "ollama" }),
      execution.id,
    );
    const cloudGroup = await runGraph(
      graphWith({
        model: "claude-sonnet-4-5",
        provider: "anthropic",
        keyId: "k-work",
      }),
      execution.id,
    );

    const [local] = await usage.list({
      limit: 50,
      offset: 0,
      groupId: localGroup,
    });
    assertEquals(local.provider, "ollama");
    assertEquals(local.location, "local");
    assertEquals(local.role, "delegate");
    assertEquals(local.keyAlias, null);
    assertEquals(local.inputTokens, 40);
    assertEquals(local.outputTokens, 6);
    assertEquals(local.context, {
      kind: "execution",
      executionId: execution.id,
      historyId: null,
      nodeId: "writer",
    });

    const [cloud] = await usage.list({
      limit: 50,
      offset: 0,
      groupId: cloudGroup,
    });
    assertEquals(cloud.provider, "anthropic");
    assertEquals(cloud.location, "cloud");
    assertEquals(cloud.keyAlias, "work");
    assertEquals(cloud.outputTokens, 9);
    assertEquals(cloud.status, "ok");
    // streamEvents makes the model stream, so the first token is timed.
    assertEquals(typeof cloud.ttftMs, "number");
    assertEquals(cloud.context.kind, "execution");

    // Both runs of the same execution can be told apart or read together.
    const all = await usage.list({
      limit: 50,
      offset: 0,
      executionId: execution.id,
    });
    assertEquals(all.length, 2);
  } finally {
    globalThis.fetch = realFetch;
    setUsageRecorder(undefined);
    setKeyAliasResolver(() => Promise.resolve(undefined));
  }
});
