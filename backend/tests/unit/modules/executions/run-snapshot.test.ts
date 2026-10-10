import { assertEquals } from "@std/assert";
import {
  resolveOrchestrator,
  snapshotNodes,
} from "../../../../modules/executions/use-cases/run-execution/run-snapshot.ts";
import type { LangGraphAbstraction } from "../../../../core/ai/visual-builder/types.ts";

const aliases: Record<string, string> = { k1: "work", k2: "personal" };
const findKeyAlias = (id: string) => Promise.resolve(aliases[id]);

const graph: LangGraphAbstraction = {
  nodes: [
    { id: "start", name: "Start", type: "start", config: {} },
    {
      id: "a",
      name: "Local node",
      type: "llm",
      config: { model: "llama3" },
    },
    {
      id: "b",
      name: "Cloud node",
      type: "llm",
      config: { model: "claude-x", provider: "anthropic", keyId: "k2" },
    },
    // What applyDefaultModel leaves behind once "Default model" is resolved.
    {
      id: "c",
      name: "Resolved default",
      type: "llm",
      config: { model: "claude-x", provider: "anthropic", keyId: "k1" },
    },
    { id: "d", name: "No model yet", type: "llm", config: {} },
    { id: "e", name: "Plugin", type: "plugin", config: { pluginId: "p" } },
    { id: "end", name: "End", type: "end", config: {} },
  ],
  edges: [],
  stateSchema: {},
};

Deno.test("snapshotNodes - keeps the resolved model of each model node, with the key alias", async () => {
  const nodes = await snapshotNodes(graph, findKeyAlias);
  const by = Object.fromEntries(nodes.map((n) => [n.id, n]));

  assertEquals(by.a.model, {
    provider: "ollama",
    model: "llama3",
    location: "local",
    keyId: null,
    keyAlias: null,
  });
  assertEquals(by.b.model?.location, "cloud");
  assertEquals(by.b.model?.keyAlias, "personal");
  assertEquals(by.c.model?.keyAlias, "work");
});

Deno.test("snapshotNodes - nodes without a model, and non-model nodes, have none", async () => {
  const nodes = await snapshotNodes(graph, findKeyAlias);
  const by = Object.fromEntries(nodes.map((n) => [n.id, n]));
  assertEquals(by.d.model, null);
  assertEquals(by.e.model, null);
  assertEquals(by.start.model, null);
  assertEquals(nodes.map((n) => n.name)[1], "Local node");
});

Deno.test("snapshotNodes - a key that no longer exists leaves the alias empty, not invented", async () => {
  const nodes = await snapshotNodes(graph, () => Promise.resolve(undefined));
  assertEquals(nodes.find((n) => n.id === "b")?.model?.keyAlias, null);
});

Deno.test("resolveOrchestrator - uses the model the graph was generated with", async () => {
  const o = await resolveOrchestrator(
    { provider: "anthropic", model: "claude-x", keyId: "k1" },
    { provider: "ollama", model: "llama3" },
    findKeyAlias,
  );
  assertEquals(o?.source, "generation");
  assertEquals(o?.model, "claude-x");
  assertEquals(o?.keyAlias, "work");
});

Deno.test("resolveOrchestrator - an older graph falls back to the chat's current model and says so", async () => {
  const o = await resolveOrchestrator(
    null,
    { provider: "ollama", model: "llama3" },
    findKeyAlias,
  );
  assertEquals(o?.source, "current");
  assertEquals(o?.location, "local");
});

Deno.test("resolveOrchestrator - nothing recorded and no current model is unknown", async () => {
  assertEquals(
    await resolveOrchestrator(null, { provider: "ollama", model: "" }, findKeyAlias),
    null,
  );
});
