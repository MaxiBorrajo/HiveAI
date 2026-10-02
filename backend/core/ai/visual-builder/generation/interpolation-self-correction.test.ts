import { assertEquals } from "@std/assert";
import { runInterpolationSelfCorrection } from "./interpolation-self-correction.ts";
import type {
  GraphNode,
  InterpolationSelfCorrectionContext,
  LangGraphAbstraction,
  PluginInfo,
} from "../types.ts";

function node(overrides: Partial<GraphNode>): GraphNode {
  return { id: "n1", name: "Node", type: "plugin", config: {}, ...overrides };
}

const plugins: PluginInfo[] = [
  {
    name: "web-search",
    description: "search the web",
    parameterKeys: ["query"],
    parametersDescription: "query (REQUIRED)",
  } as PluginInfo,
];

async function collect<T>(gen: AsyncGenerator<T, void, unknown>): Promise<T[]> {
  const out: T[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

// Fake ChatOllama-like object: withStructuredOutput returns an agent whose
// .invoke() always resolves with `fixedConfig` (bypassing real LLM calls).
function fakeConfigLlm(fixedConfig: Record<string, unknown>): any {
  return {
    withStructuredOutput: () => ({
      invoke: async () => fixedConfig,
    }),
  };
}

Deno.test("runInterpolationSelfCorrection - a graph with no violations yields nothing and never touches the LLM", async () => {
  const graph: LangGraphAbstraction = {
    nodes: [
      node({ id: "search", type: "plugin", config: { pluginId: "web-search", inputMapping: { query: "cats" } } }),
    ],
    edges: [],
    stateSchema: {},
  };
  const ctx: InterpolationSelfCorrectionContext = {
    graph,
    availablePlugins: plugins,
    // An LLM that always throws — proves it's never invoked on this path.
    configLlm: { withStructuredOutput: () => { throw new Error("should not be called"); } } as any,
    nodeDescriptions: new Map(),
  };

  const events = await collect(runInterpolationSelfCorrection(ctx));
  assertEquals(events, []);
});

Deno.test("runInterpolationSelfCorrection - an 'llm' node mentioning an unequipped tool gets it auto-equipped deterministically (no LLM call)", async () => {
  const llmNode = node({
    id: "agent",
    type: "llm",
    config: { systemPrompt: "Use web-search to find results.", plugins: [] },
  });
  const graph: LangGraphAbstraction = { nodes: [llmNode], edges: [], stateSchema: {} };
  const ctx: InterpolationSelfCorrectionContext = {
    graph,
    availablePlugins: plugins,
    configLlm: { withStructuredOutput: () => { throw new Error("should not be called for llm tool-equip fix"); } } as any,
    nodeDescriptions: new Map(),
  };

  const events = await collect(runInterpolationSelfCorrection(ctx));
  assertEquals(events.some((e) => e.type === "node_fixed"), true);
  assertEquals((llmNode.config.plugins as string[]).includes("web-search"), true);
});

Deno.test("runInterpolationSelfCorrection - a plugin node with a bad inputMapping is corrected via the (mocked) LLM retry path, without reaching the deterministic fallback", async () => {
  // A real upstream node that actually produces "search_results" as its
  // outputKey, so once the LLM "fixes" the mapping to reference it bare,
  // re-validation passes and the loop exits BEFORE exhausting retries.
  const upstream = node({ id: "upstream", type: "plugin", config: { pluginId: "web-search", outputKey: "search_results" } });
  const pluginNode = node({
    id: "search",
    type: "plugin",
    config: { pluginId: "web-search", inputMapping: { query: "${search_results.results[0].url}" } },
  });
  const graph: LangGraphAbstraction = {
    nodes: [upstream, pluginNode],
    edges: [{ id: "e1", source: "upstream", target: "search", isConditional: false }],
    stateSchema: { search_results: { type: "string", required: false } },
  };
  const ctx: InterpolationSelfCorrectionContext = {
    graph,
    availablePlugins: plugins,
    configLlm: fakeConfigLlm({ inputMapping: { query: "${search_results}" } }),
    nodeDescriptions: new Map(),
  };

  const events = await collect(runInterpolationSelfCorrection(ctx));
  assertEquals(events.some((e) => e.type === "validation_error"), true);
  assertEquals(events.some((e) => e.type === "node_fixed"), true);
  assertEquals((pluginNode.config.inputMapping as any).query, "${search_results}");
});

Deno.test("runInterpolationSelfCorrection - once retries are exhausted, the deterministic fallback rewrites the bad reference to the predecessor's outputKey", async () => {
  const upstream = node({ id: "upstream", type: "plugin", config: { pluginId: "web-search", outputKey: "search_results" } });
  const pluginNode = node({
    id: "search2",
    type: "plugin",
    config: { pluginId: "web-search", inputMapping: { query: "${bogus.path[0]}" } },
  });
  const graph: LangGraphAbstraction = {
    nodes: [upstream, pluginNode],
    edges: [{ id: "e1", source: "upstream", target: "search2", isConditional: false }],
    stateSchema: { search_results: { type: "string", required: false } },
  };
  const ctx: InterpolationSelfCorrectionContext = {
    graph,
    availablePlugins: plugins,
    // The LLM "retry" always returns the SAME broken mapping, so validation
    // keeps failing and the deterministic fallback must kick in.
    configLlm: fakeConfigLlm({ inputMapping: { query: "${bogus.path[0]}" } }),
    nodeDescriptions: new Map(),
  };

  await collect(runInterpolationSelfCorrection(ctx));

  // The deterministic fallback replaces the ${...} reference with the
  // immediate predecessor's real outputKey.
  assertEquals(
    (pluginNode.config.inputMapping as any).query,
    "${search_results}",
  );
});
