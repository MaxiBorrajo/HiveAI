import { assertEquals } from "@std/assert";
import type { GraphNode, LlmNodeConfiguratorContext } from "../types.ts";
import type { ModelSelection } from "../../providers/model-selection.ts";
import { configureLlmNode } from "./llm-node-configurator.ts";

const selection: ModelSelection = {
  orchestrator: { provider: "anthropic", model: "claude-opus-5-5", keyId: "k1" },
  catalog: [
    { id: "anthropic:claude-opus-5-5", ref: { provider: "anthropic", model: "claude-opus-5-5", keyId: "k1" }, label: "", capabilities: [] },
    { id: "ollama:qwen3:8b", ref: { provider: "ollama", model: "qwen3:8b" }, label: "", capabilities: [] },
  ],
};

function setup(replies: Record<string, unknown>[]) {
  let calls = 0;
  const node: GraphNode = { id: "n1", name: "Summarize", type: "llm", config: {} };
  const ctx: LlmNodeConfiguratorContext = {
    prompt: "summarize",
    modelName: "fallback-model",
    modelSelection: selection,
    availablePlugins: [],
    pluginNames: new Set(),
    // deno-lint-ignore no-explicit-any
    configLlm: {
      withStructuredOutput: () => ({
        invoke: () => Promise.resolve(replies[Math.min(calls++, replies.length - 1)]),
      }),
    } as any,
    graph: {
      nodes: [node],
      edges: [],
      stateSchema: {},
    },
    intermediateNodes: [node],
    nodeDescriptions: new Map(),
    neighborHint: "",
    graphStateText: "",
  };
  return { node, ctx, calls: () => calls };
}

const base = { nodeId: "n1", nodeName: "Summarize", systemPrompt: "Do the summary", outputKey: "summary" };

Deno.test("configureLlmNode - a valid proposal sets that model and key", async () => {
  const { node, ctx } = setup([{ ...base, modelChoice: "ollama:qwen3:8b" }]);
  await configureLlmNode(node, ctx);
  assertEquals(node.config.model, "qwen3:8b");
  assertEquals(node.config.provider, undefined);
});

Deno.test("configureLlmNode - an invalid proposal is retried and a later valid one wins", async () => {
  const { node, ctx, calls } = setup([
    { ...base, modelChoice: "made-up:model" },
    { ...base, modelChoice: "anthropic:claude-opus-5-5" },
  ]);
  await configureLlmNode(node, ctx);
  assertEquals(calls(), 2);
  assertEquals(node.config.model, "claude-opus-5-5");
  assertEquals(node.config.provider, "anthropic");
  assertEquals(node.config.keyId, "k1");
});

Deno.test("configureLlmNode - after repeated invalid proposals it keeps the config on the default model", async () => {
  const { node, ctx, calls } = setup([{ ...base, modelChoice: "made-up:model" }]);
  await configureLlmNode(node, ctx);
  assertEquals(calls(), 3);
  assertEquals(node.config.model, "claude-opus-5-5");
  assertEquals(String(node.config.systemPrompt).includes("Do the summary"), true);
});
