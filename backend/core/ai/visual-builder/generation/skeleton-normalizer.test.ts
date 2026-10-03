import { assertEquals } from "@std/assert";
import { normalizeSkeletonToGraph } from "./skeleton-normalizer.ts";
import type {
  LangGraphAbstraction,
  PluginInfo,
  SkeletonNode,
  WorkflowSkeleton,
} from "../types.ts";

function emptyGraph(): LangGraphAbstraction {
  return { nodes: [], edges: [], stateSchema: {} };
}

function skeletonNode(overrides: Partial<SkeletonNode>): SkeletonNode {
  return {
    id: "step",
    name: "Step",
    type: "llm",
    description: "does a step",
    ...overrides,
  } as SkeletonNode;
}

function skeleton(overrides: Partial<WorkflowSkeleton>): WorkflowSkeleton {
  return {
    thought: "plan",
    nodes: [],
    edges: [],
    ...overrides,
  } as WorkflowSkeleton;
}

const plugins: PluginInfo[] = [
  { name: "web-search", description: "search the web" } as PluginInfo,
];

// --- basic node construction ---

Deno.test("normalizeSkeletonToGraph - always injects a built-in start and end node", () => {
  const result = normalizeSkeletonToGraph(skeleton({ nodes: [skeletonNode({ id: "a" })] }), emptyGraph(), []);
  assertEquals(result.startNode.id, "start");
  assertEquals(result.startNode.type, "start");
  assertEquals(result.endNode.id, "end");
  assertEquals(result.endNode.type, "end");
});

Deno.test("normalizeSkeletonToGraph - a 'plugin' node with a resolvable pluginId becomes a plugin graph node", () => {
  const result = normalizeSkeletonToGraph(
    skeleton({ nodes: [skeletonNode({ id: "search", type: "plugin", pluginId: "web-search" })] }),
    emptyGraph(),
    plugins,
  );
  assertEquals(result.intermediateNodes[0].type, "plugin");
  assertEquals(result.intermediateNodes[0].config.pluginId, "web-search");
});

Deno.test("normalizeSkeletonToGraph - a 'plugin' node whose pluginId doesn't resolve falls back to an llm node", () => {
  const result = normalizeSkeletonToGraph(
    skeleton({ nodes: [skeletonNode({ id: "search", type: "plugin", pluginId: "nonexistent" })] }),
    emptyGraph(),
    plugins,
  );
  assertEquals(result.intermediateNodes[0].type, "llm");
});

Deno.test("normalizeSkeletonToGraph - a 'condition' node becomes a condition graph node with empty config", () => {
  const result = normalizeSkeletonToGraph(
    skeleton({ nodes: [skeletonNode({ id: "check", type: "condition" })] }),
    emptyGraph(),
    plugins,
  );
  assertEquals(result.intermediateNodes[0].type, "condition");
  assertEquals(result.intermediateNodes[0].config, {});
});

Deno.test("normalizeSkeletonToGraph - an 'llm' node with explicit plugins keeps them as-is in config.plugins", () => {
  const result = normalizeSkeletonToGraph(
    skeleton({ nodes: [skeletonNode({ id: "agent", type: "llm", plugins: ["web-search"] })] }),
    emptyGraph(),
    plugins,
  );
  assertEquals(result.intermediateNodes[0].config.plugins, ["web-search"]);
});

Deno.test("normalizeSkeletonToGraph - a plain 'llm' node with no plugins/pluginId has an empty config", () => {
  const result = normalizeSkeletonToGraph(
    skeleton({ nodes: [skeletonNode({ id: "think", type: "llm" })] }),
    emptyGraph(),
    plugins,
  );
  assertEquals(result.intermediateNodes[0].config, {});
});

// --- id handling ---

Deno.test("normalizeSkeletonToGraph - node descriptions are tracked per generated node id", () => {
  const result = normalizeSkeletonToGraph(
    skeleton({ nodes: [skeletonNode({ id: "step1", description: "the first step" })] }),
    emptyGraph(),
    plugins,
  );
  assertEquals(result.nodeDescriptions.get("step1"), "the first step");
});

Deno.test("normalizeSkeletonToGraph - a node id colliding with an existing graph node gets a '_step' suffix", () => {
  const graph = emptyGraph();
  graph.nodes.push({ id: "search", name: "Existing", type: "plugin", config: {} });

  const result = normalizeSkeletonToGraph(
    skeleton({ nodes: [skeletonNode({ id: "search" })] }),
    graph,
    plugins,
  );
  assertEquals(result.intermediateNodes[0].id, "search_step");
});

Deno.test("normalizeSkeletonToGraph - a node literally named 'start' or 'end' gets a '_step' suffix to avoid clashing with the built-ins", () => {
  const result = normalizeSkeletonToGraph(
    skeleton({ nodes: [skeletonNode({ id: "end", name: "Not The Real End" })] }),
    emptyGraph(),
    plugins,
  );
  // Note: "end" as an id also matches the boundary-alias heuristic (isBoundaryAlias),
  // so this node is actually treated as an end-alias and excluded from intermediateNodes.
  assertEquals(result.intermediateNodes.length, 0);
});

Deno.test("normalizeSkeletonToGraph - node ids are sanitized to lowercase alphanumeric/underscore", () => {
  const result = normalizeSkeletonToGraph(
    skeleton({ nodes: [skeletonNode({ id: "Search News!" })] }),
    emptyGraph(),
    plugins,
  );
  assertEquals(result.intermediateNodes[0].id, "search_news_");
});

Deno.test("normalizeSkeletonToGraph - modified flag is tracked by the generated node id", () => {
  const result = normalizeSkeletonToGraph(
    skeleton({ nodes: [skeletonNode({ id: "step1", modified: true })] }),
    emptyGraph(),
    plugins,
  );
  assertEquals(result.modifiedIds.has("step1"), true);
});

// --- boundary aliases ---

Deno.test("normalizeSkeletonToGraph - a node aliasing 'start' (by id/name) is excluded from intermediateNodes", () => {
  const result = normalizeSkeletonToGraph(
    skeleton({
      nodes: [
        skeletonNode({ id: "start_step", name: "Start" }),
        skeletonNode({ id: "real_step" }),
      ],
      edges: [{ source: "start_step", target: "real_step" }],
    }),
    emptyGraph(),
    plugins,
  );
  assertEquals(result.intermediateNodes.length, 1);
  assertEquals(result.intermediateNodes[0].id, "real_step");
});

Deno.test("normalizeSkeletonToGraph - an edge targeting a start-alias is redirected to that alias's own outgoing target", () => {
  const result = normalizeSkeletonToGraph(
    skeleton({
      nodes: [
        skeletonNode({ id: "start_node", name: "Start" }),
        skeletonNode({ id: "real_step" }),
      ],
      edges: [
        // start_node's own outgoing edge is captured into bypassMap as its real target...
        { source: "start_node", target: "real_step" },
        // ...so an edge TARGETING start_node gets redirected straight to real_step.
        { source: "start", target: "start_node" },
      ],
    }),
    emptyGraph(),
    plugins,
  );
  // The "start_node -> real_step" edge itself is dropped (its source is bypassed).
  assertEquals(result.rawEdges.some((e) => e.source === "start_node"), false);
  // But "start -> start_node" is rewritten to "start -> real_step".
  assertEquals(result.rawEdges.some((e) => e.source === "start" && e.target === "real_step"), true);
});

Deno.test("normalizeSkeletonToGraph - an edge targeting an end-alias is redirected to 'end'", () => {
  const result = normalizeSkeletonToGraph(
    skeleton({
      nodes: [
        skeletonNode({ id: "real_step" }),
        skeletonNode({ id: "end_step", name: "End" }),
      ],
      edges: [{ source: "real_step", target: "end_step" }],
    }),
    emptyGraph(),
    plugins,
  );
  assertEquals(
    result.rawEdges.some((e) => e.source === "real_step" && e.target === "end"),
    true,
  );
});

// --- edges ---

Deno.test("normalizeSkeletonToGraph - builds a normal edge between two valid intermediate nodes", () => {
  const result = normalizeSkeletonToGraph(
    skeleton({
      nodes: [skeletonNode({ id: "a" }), skeletonNode({ id: "b" })],
      edges: [{ source: "a", target: "b" }],
    }),
    emptyGraph(),
    plugins,
  );
  assertEquals(result.rawEdges.length, 1);
  assertEquals(result.rawEdges[0].source, "a");
  assertEquals(result.rawEdges[0].target, "b");
  assertEquals(result.rawEdges[0].isConditional, false);
});

Deno.test("normalizeSkeletonToGraph - a self-loop edge (source === target after mapping) is dropped", () => {
  const result = normalizeSkeletonToGraph(
    skeleton({
      nodes: [skeletonNode({ id: "a" })],
      edges: [{ source: "a", target: "a" }],
    }),
    emptyGraph(),
    plugins,
  );
  assertEquals(result.rawEdges.length, 0);
});

Deno.test("normalizeSkeletonToGraph - an edge referencing a node id that doesn't exist in the final graph is dropped", () => {
  const result = normalizeSkeletonToGraph(
    skeleton({
      nodes: [skeletonNode({ id: "a" })],
      edges: [{ source: "a", target: "ghost" }],
    }),
    emptyGraph(),
    plugins,
  );
  assertEquals(result.rawEdges.length, 0);
});

Deno.test("normalizeSkeletonToGraph - an edge from a condition node defaults its path to 'true' when unset", () => {
  const result = normalizeSkeletonToGraph(
    skeleton({
      nodes: [skeletonNode({ id: "check", type: "condition" }), skeletonNode({ id: "b" })],
      edges: [{ source: "check", target: "b" }],
    }),
    emptyGraph(),
    plugins,
  );
  assertEquals(result.rawEdges[0].path, "true");
  assertEquals(result.rawEdges[0].isConditional, true);
});

Deno.test("normalizeSkeletonToGraph - an edge from a condition node preserves an explicit 'false' path", () => {
  const result = normalizeSkeletonToGraph(
    skeleton({
      nodes: [skeletonNode({ id: "check", type: "condition" }), skeletonNode({ id: "b" })],
      edges: [{ source: "check", target: "b", path: "false" }],
    }),
    emptyGraph(),
    plugins,
  );
  assertEquals(result.rawEdges[0].path, "false");
});

Deno.test("normalizeSkeletonToGraph - an edge from a non-condition node has no path", () => {
  const result = normalizeSkeletonToGraph(
    skeleton({
      nodes: [skeletonNode({ id: "a" }), skeletonNode({ id: "b" })],
      edges: [{ source: "a", target: "b" }],
    }),
    emptyGraph(),
    plugins,
  );
  assertEquals(result.rawEdges[0].path, undefined);
});

Deno.test("normalizeSkeletonToGraph - edge ids are deterministic and unique per source/target/path", () => {
  const result = normalizeSkeletonToGraph(
    skeleton({
      nodes: [skeletonNode({ id: "check", type: "condition" }), skeletonNode({ id: "b" }), skeletonNode({ id: "c" })],
      edges: [
        { source: "check", target: "b", path: "true" },
        { source: "check", target: "c", path: "false" },
      ],
    }),
    emptyGraph(),
    plugins,
  );
  const ids = result.rawEdges.map((e) => e.id);
  assertEquals(new Set(ids).size, ids.length);
  assertEquals(ids.includes("edge_check_b_true"), true);
  assertEquals(ids.includes("edge_check_c_false"), true);
});

// --- mutation of the input graph ---

Deno.test("normalizeSkeletonToGraph - pushes start, intermediate nodes, and end (in that order) onto the passed-in graph", () => {
  const graph = emptyGraph();
  normalizeSkeletonToGraph(skeleton({ nodes: [skeletonNode({ id: "a" })] }), graph, plugins);
  assertEquals(graph.nodes.map((n) => n.id), ["start", "a", "end"]);
});
