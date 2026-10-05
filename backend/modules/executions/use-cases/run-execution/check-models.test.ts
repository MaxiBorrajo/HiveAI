import { assertEquals } from "@std/assert";
import { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import type { LangGraphAbstraction } from "../../../../core/ai/visual-builder/types.ts";
import {
  applyDefaultModel,
  checkGraphModels,
  type ModelCheckDeps,
} from "./check-models.ts";

const deps: ModelCheckDeps = {
  findKeyAlias: (id) => Promise.resolve(id === "live" ? "Claude – personal" : undefined),
  listLocalModels: () => Promise.resolve(new Set(["qwen3:8b"])),
};

function graph(...configs: Record<string, unknown>[]): LangGraphAbstraction {
  return {
    nodes: configs.map((config, i) => ({
      id: `n${i}`,
      name: `Node ${i}`,
      type: "llm" as const,
      config,
    })),
    edges: [],
    stateSchema: {},
  };
}

Deno.test("checkGraphModels - cloud + local mix with live key passes", async () => {
  const problems = await checkGraphModels(
    graph(
      { model: "claude-sonnet-5-5", provider: "anthropic", keyId: "live" },
      { model: "qwen3:8b" },
    ),
    deps,
  );
  assertEquals(problems, []);
});

Deno.test("checkGraphModels - deleted key explains the reason and the node", async () => {
  const [p] = await checkGraphModels(
    graph({ model: "gpt-4.1", provider: "openai", keyId: "gone" }),
    deps,
  );
  assertEquals(p.nodeId, "n0");
  assertEquals(p.reason.includes("no longer exists"), true);
});

Deno.test("checkGraphModels - missing key, missing local model, no model", async () => {
  const problems = await checkGraphModels(
    graph(
      { model: "gemini-2.5-pro", provider: "google" },
      { model: "not-installed:1b" },
      {},
    ),
    deps,
  );
  assertEquals(problems.length, 3);
});

Deno.test("checkGraphModels - skips the local check when Ollama can't be queried", async () => {
  const problems = await checkGraphModels(graph({ model: "x" }), {
    ...deps,
    listLocalModels: () => Promise.resolve(null),
  });
  assertEquals(problems, []);
});

Deno.test("applyDefaultModel - fills nodes without a model with the chat model", () => {
  const hive = new HiveMicrokernel();
  hive.configure({ model: "claude-sonnet-5-5", modelProvider: "anthropic", modelKeyId: "live" });
  const g = applyDefaultModel(graph({}, { model: "qwen3:8b" }), hive);
  assertEquals(g.nodes[0].config, {
    model: "claude-sonnet-5-5",
    provider: "anthropic",
    keyId: "live",
  });
  assertEquals(g.nodes[1].config, { model: "qwen3:8b" });
});
