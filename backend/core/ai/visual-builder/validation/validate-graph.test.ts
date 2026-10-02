import { assertEquals } from "@std/assert";
import {
  validateGraph,
  validateGraphStructure,
  validateGraphInputMappings,
} from "./validate-graph.ts";
import { GraphEdge, GraphNode, LangGraphAbstraction, PluginParameterInfo } from "../types.ts";

function node(overrides: Partial<GraphNode>): GraphNode {
  return { id: "n", name: "Node", type: "plugin", config: {}, ...overrides };
}

function edge(overrides: Partial<GraphEdge>): GraphEdge {
  return { id: "e", source: "a", target: "b", isConditional: false, ...overrides };
}

// A minimal, fully valid graph: start -> plugin step -> end
function validGraph(): LangGraphAbstraction {
  return {
    nodes: [
      { id: "start", name: "Start", type: "start", config: {} },
      node({
        id: "step",
        name: "Step",
        type: "plugin",
        config: { pluginId: "web-search", outputKey: "search_results", inputMapping: {} },
      }),
      {
        id: "end",
        name: "End",
        type: "end",
        config: { output: { type: "text", contentKey: "search_results" } },
      },
    ],
    edges: [
      edge({ id: "e1", source: "start", target: "step" }),
      edge({ id: "e2", source: "step", target: "end" }),
    ],
    stateSchema: {},
  };
}

const plugins: PluginParameterInfo[] = [{ name: "web-search", parameterKeys: ["query"] }];

// --- validateGraphStructure ---

Deno.test("validateGraphStructure - a well-formed graph has no structural violations", () => {
  assertEquals(validateGraphStructure(validGraph()), []);
});

Deno.test("validateGraphStructure - duplicate node ids are flagged", () => {
  const g = validGraph();
  g.nodes.push({ ...g.nodes[1] });
  const violations = validateGraphStructure(g);
  assertEquals(violations.some((v) => v.kind === "duplicate_node_id"), true);
});

Deno.test("validateGraphStructure - missing a start or end node is flagged", () => {
  const g = validGraph();
  g.nodes = g.nodes.filter((n) => n.type !== "end");
  const violations = validateGraphStructure(g);
  assertEquals(violations.some((v) => v.kind === "invalid_start_end_count" && v.field === "end"), true);
});

Deno.test("validateGraphStructure - more than one start node is flagged", () => {
  const g = validGraph();
  g.nodes.push({ id: "start2", name: "Start 2", type: "start", config: {} });
  const violations = validateGraphStructure(g);
  assertEquals(violations.some((v) => v.kind === "invalid_start_end_count" && v.field === "start"), true);
});

Deno.test("validateGraphStructure - duplicate edge ids are flagged", () => {
  const g = validGraph();
  g.edges.push({ ...g.edges[0] });
  const violations = validateGraphStructure(g);
  assertEquals(violations.some((v) => v.kind === "duplicate_edge_id"), true);
});

Deno.test("validateGraphStructure - an edge pointing to a non-existent node is flagged as dangling", () => {
  const g = validGraph();
  g.edges.push(edge({ id: "e3", source: "step", target: "ghost" }));
  const violations = validateGraphStructure(g);
  assertEquals(violations.some((v) => v.kind === "dangling_edge" && v.field === "target"), true);
});

// --- validateGraph (structural short-circuit) ---

Deno.test("validateGraph - a fully valid graph produces no violations", () => {
  assertEquals(validateGraph(validGraph(), plugins), []);
});

Deno.test("validateGraph - structural violations short-circuit and skip deeper (reachability/config) checks", () => {
  const g = validGraph();
  g.nodes = g.nodes.filter((n) => n.type !== "end");
  const violations = validateGraph(g, plugins);
  // Removing the end node leaves a dangling edge too, but both are still
  // structural (validateGraphStructure) violations — deeper checks like
  // reachability or node-config validation must never run alongside them.
  const structuralKinds = new Set(["invalid_start_end_count", "dangling_edge"]);
  assertEquals(violations.every((v) => structuralKinds.has(v.kind)), true);
  assertEquals(violations.some((v) => v.kind === "invalid_start_end_count"), true);
});

// --- edge rules ---

Deno.test("validateGraph - a self-loop edge is flagged as invalid_edge", () => {
  const g = validGraph();
  g.edges.push(edge({ id: "e3", source: "step", target: "step" }));
  const violations = validateGraph(g, plugins);
  assertEquals(violations.some((v) => v.kind === "invalid_edge" && v.field === "target"), true);
});

Deno.test("validateGraph - an incoming edge to the start node is flagged", () => {
  const g = validGraph();
  g.edges.push(edge({ id: "e3", source: "step", target: "start" }));
  const violations = validateGraph(g, plugins);
  assertEquals(
    violations.some((v) => v.kind === "invalid_edge" && v.reason.includes("start node cannot have incoming")),
    true,
  );
});

Deno.test("validateGraph - an outgoing edge from the end node is flagged", () => {
  const g = validGraph();
  g.edges.push(edge({ id: "e3", source: "end", target: "step" }));
  const violations = validateGraph(g, plugins);
  assertEquals(
    violations.some((v) => v.kind === "invalid_edge" && v.reason.includes("end node cannot have outgoing")),
    true,
  );
});

Deno.test("validateGraph - an edge from a condition node missing a true/false path is flagged", () => {
  const g = validGraph();
  g.nodes.splice(1, 0, node({ id: "cond", name: "Cond", type: "condition", config: { condition: { field: "input", operator: "equals", value: "x" } } }));
  g.edges = [
    edge({ id: "e1", source: "start", target: "cond" }),
    edge({ id: "e2", source: "cond", target: "step" }), // no path
    edge({ id: "e3", source: "step", target: "end" }),
  ];
  const violations = validateGraph(g, plugins);
  assertEquals(violations.some((v) => v.kind === "condition_edge_missing_path"), true);
});

// --- reachability ---

Deno.test("validateGraph - a node disconnected from the flow is flagged as unreachable and unable to reach end", () => {
  const g = validGraph();
  g.nodes.push(node({ id: "orphan", name: "Orphan", type: "plugin", config: { pluginId: "web-search", outputKey: "orphan_data" } }));
  const violations = validateGraph(g, plugins);
  assertEquals(violations.some((v) => v.kind === "unreachable_node" && v.nodeId === "orphan"), true);
  assertEquals(violations.some((v) => v.kind === "cannot_reach_end" && v.nodeId === "orphan"), true);
});

// --- node config validation ---

Deno.test("validateGraph - a plugin node without an outputKey is flagged", () => {
  const g = validGraph();
  delete (g.nodes[1].config as any).outputKey;
  const violations = validateGraph(g, plugins);
  assertEquals(violations.some((v) => v.kind === "invalid_output_key" && v.reason.includes("no outputKey")), true);
});

Deno.test("validateGraph - using a reserved builtin key as outputKey is flagged", () => {
  const g = validGraph();
  (g.nodes[1].config as any).outputKey = "input";
  const violations = validateGraph(g, plugins);
  assertEquals(violations.some((v) => v.kind === "invalid_output_key" && v.reason.includes("reserved")), true);
});

Deno.test("validateGraph - two nodes sharing the same outputKey is flagged", () => {
  const g = validGraph();
  g.nodes.splice(2, 0, node({
    id: "step2",
    name: "Step 2",
    type: "plugin",
    config: { pluginId: "web-search", outputKey: "search_results" },
  }));
  g.edges = [
    edge({ id: "e1", source: "start", target: "step" }),
    edge({ id: "e2", source: "step", target: "step2" }),
    edge({ id: "e3", source: "step2", target: "end" }),
  ];
  const violations = validateGraph(g, plugins);
  assertEquals(violations.some((v) => v.kind === "invalid_output_key" && v.reason.includes("already written")), true);
});

Deno.test("validateGraph - a plugin node without a pluginId is flagged", () => {
  const g = validGraph();
  delete (g.nodes[1].config as any).pluginId;
  const violations = validateGraph(g, plugins);
  assertEquals(violations.some((v) => v.kind === "invalid_node_config" && v.field === "pluginId"), true);
});

Deno.test("validateGraph - an llm node with an empty systemPrompt is flagged", () => {
  const g = validGraph();
  g.nodes[1] = node({ id: "step", name: "Step", type: "llm", config: { outputKey: "search_results" } });
  const violations = validateGraph(g, plugins);
  assertEquals(violations.some((v) => v.kind === "invalid_node_config" && v.field === "systemPrompt"), true);
});

Deno.test("validateGraph - an llm node referencing an unregistered plugin is flagged", () => {
  const g = validGraph();
  g.nodes[1] = node({
    id: "step",
    name: "Step",
    type: "llm",
    config: { outputKey: "search_results", systemPrompt: "Do stuff", plugins: ["not-a-real-plugin"] },
  });
  const violations = validateGraph(g, plugins);
  assertEquals(violations.some((v) => v.kind === "unknown_plugin"), true);
});

Deno.test("validateGraph - an end node without an output.type is flagged", () => {
  const g = validGraph();
  g.nodes[2] = { id: "end", name: "End", type: "end", config: {} };
  const violations = validateGraph(g, plugins);
  assertEquals(violations.some((v) => v.kind === "invalid_node_config" && v.field === "output.type"), true);
});

Deno.test("validateGraph - an end node referencing an unknown contentKey is flagged", () => {
  const g = validGraph();
  g.nodes[2] = { id: "end", name: "End", type: "end", config: { output: { type: "text", contentKey: "nonexistent_var" } } };
  const violations = validateGraph(g, plugins);
  assertEquals(violations.some((v) => v.kind === "undefined_variable" && v.field === "output.contentKey"), true);
});

Deno.test("validateGraph - a condition node with no field is flagged", () => {
  const g = validGraph();
  g.nodes.splice(1, 0, node({ id: "cond", name: "Cond", type: "condition", config: {} }));
  g.edges = [
    edge({ id: "e1", source: "start", target: "cond" }),
    edge({ id: "e2", source: "cond", target: "step", path: "true" }),
    edge({ id: "e2b", source: "cond", target: "end", path: "false" }),
    edge({ id: "e3", source: "step", target: "end" }),
  ];
  const violations = validateGraph(g, plugins);
  assertEquals(violations.some((v) => v.kind === "invalid_node_config" && v.field === "condition.field"), true);
});

Deno.test("validateGraph - a condition node with an invalid operator is flagged", () => {
  const g = validGraph();
  g.nodes.splice(1, 0, node({
    id: "cond",
    name: "Cond",
    type: "condition",
    config: { condition: { field: "input", operator: "bogus_op", value: "x" } },
  }));
  g.edges = [
    edge({ id: "e1", source: "start", target: "cond" }),
    edge({ id: "e2", source: "cond", target: "step", path: "true" }),
    edge({ id: "e2b", source: "cond", target: "end", path: "false" }),
    edge({ id: "e3", source: "step", target: "end" }),
  ];
  const violations = validateGraph(g, plugins);
  assertEquals(violations.some((v) => v.kind === "invalid_node_config" && v.field === "condition.operator"), true);
});

// --- condition branch structural checks (delegated to graph-sanitizer) ---

Deno.test("validateGraph - a condition node missing its true/false branches is flagged via findMissingConditionBranches", () => {
  const g = validGraph();
  g.nodes.splice(1, 0, node({
    id: "cond",
    name: "Cond",
    type: "condition",
    config: { condition: { field: "input", operator: "equals", value: "x" } },
  }));
  g.edges = [
    edge({ id: "e1", source: "start", target: "cond" }),
    edge({ id: "e2", source: "cond", target: "step", path: "true" }),
    edge({ id: "e3", source: "step", target: "end" }),
  ];
  const violations = validateGraph(g, plugins);
  assertEquals(violations.some((v) => v.kind === "missing_condition_branch" && v.field === "false"), true);
});

Deno.test("validateGraph - a condition node whose true/false branches converge immediately is flagged", () => {
  const g = validGraph();
  g.nodes.splice(1, 0, node({
    id: "cond",
    name: "Cond",
    type: "condition",
    config: { condition: { field: "input", operator: "equals", value: "x" } },
  }));
  g.edges = [
    edge({ id: "e1", source: "start", target: "cond" }),
    edge({ id: "e2", source: "cond", target: "step", path: "true" }),
    edge({ id: "e2b", source: "cond", target: "step", path: "false" }),
    edge({ id: "e3", source: "step", target: "end" }),
  ];
  const violations = validateGraph(g, plugins);
  assertEquals(violations.some((v) => v.kind === "condition_branches_converge"), true);
});

// --- validateGraphInputMappings (thin aggregator) ---

Deno.test("validateGraphInputMappings - aggregates violations from the underlying grammar/reference/plugin/tool checks", () => {
  const g = validGraph();
  (g.nodes[1].config as any).inputMapping = { query: "${a.b}" };
  const violations = validateGraphInputMappings(g, plugins);
  assertEquals(violations.some((v) => v.kind === "syntax"), true);
});
