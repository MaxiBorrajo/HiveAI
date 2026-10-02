import type {
  GraphEdge,
  GraphNode,
  LangGraphAbstraction,
  PaletteNodeType,
  StatePropertyDefinition,
} from "../types";

export const START_NODE_ID = "start";
export const END_NODE_ID = "end";
export const BUILTIN_STATE_KEYS = ["input", "cwd", "os"];

export const CONDITION_OPERATORS = [
  "equals",
  "not_equals",
  "greater_than",
  "greater_than_or_equals",
  "less_than",
  "less_than_or_equals",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "is_empty",
  "is_not_empty",
  "in",
  "not_in",
  "regex_match",
] as const;

export const RESULT_OUTPUT_TYPES = [
  "markdown",
  "text",
  "table",
  "chart",
  "json",
  "image",
  "html",
  "url",
  "terminal",
  "boolean",
  "file",
  "error",
] as const;

const NODE_NAMES: Record<PaletteNodeType, string> = {
  start: "Start",
  end: "End",
  llm: "LLM",
  agent: "Agent",
  plugin: "Plugin",
  condition: "Condition",
};

export function emptyGraph(): LangGraphAbstraction {
  return {
    nodes: [
      { id: START_NODE_ID, name: "Start", type: "start", config: {} },
      {
        id: END_NODE_ID,
        name: "End",
        type: "end",
        config: { output: { type: "markdown", summary: "", contentKey: "" } },
      },
    ],
    edges: [],
    stateSchema: {
      input: { type: "string", required: false },
      cwd: { type: "string", required: false },
      os: { type: "string", required: false },
    },
  };
}

function uniqueId(base: string, taken: Set<string>): string {
  let n = 1;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

function uniqueOutputKey(base: string, graph: LangGraphAbstraction): string {
  const taken = new Set([
    ...BUILTIN_STATE_KEYS,
    ...graph.nodes.map((n) => n.config?.outputKey as string | undefined).filter(Boolean) as string[],
  ]);
  return taken.has(base) ? uniqueId(base, taken) : base;
}

export function hasNodeOfType(graph: LangGraphAbstraction | null | undefined, type: "start" | "end") {
  return !!graph?.nodes.some((n) => n.type === type);
}

export function createNode(
  paletteType: PaletteNodeType,
  graph: LangGraphAbstraction,
  position: { x: number; y: number },
): GraphNode {
  const taken = new Set(graph.nodes.map((n) => n.id));
  const name = NODE_NAMES[paletteType];
  const base = { name, uiPosition: position };

  switch (paletteType) {
    case "start":
      return { ...base, id: START_NODE_ID, type: "start", config: {} };
    case "end":
      return {
        ...base,
        id: END_NODE_ID,
        type: "end",
        config: { output: { type: "markdown", summary: "", contentKey: "" } },
      };
    case "condition":
      return {
        ...base,
        id: uniqueId("condition", taken),
        type: "condition",
        config: { condition: { field: "", operator: "equals", value: "" } },
      };
    case "plugin":
      return {
        ...base,
        id: uniqueId("plugin", taken),
        type: "plugin",
        config: {
          pluginId: "",
          inputMapping: {},
          outputKey: uniqueOutputKey("plugin_output", graph),
        },
      };
    case "agent":
    case "llm": {
      const id = uniqueId(paletteType, taken);
      return {
        ...base,
        id,
        type: "llm",
        config: {
          systemPrompt: "",
          inputMapping: {},
          outputKey: uniqueOutputKey(`${paletteType}_output`, graph),
          ...(paletteType === "agent" ? { plugins: [] } : {}),
        },
      };
    }
  }
}

export function syncStateSchema(graph: LangGraphAbstraction): LangGraphAbstraction {
  const previous = graph.stateSchema ?? {};
  const next: Record<string, StatePropertyDefinition> = {};

  for (const key of BUILTIN_STATE_KEYS) {
    next[key] = previous[key] ?? { type: "string", required: false };
  }
  for (const node of graph.nodes) {
    const key = node.config?.outputKey;
    if (typeof key === "string" && key && !next[key]) {
      next[key] = previous[key] ?? { type: "unknown", required: false };
    }
  }
  return { ...graph, stateSchema: next };
}

export function addNode(graph: LangGraphAbstraction, node: GraphNode): LangGraphAbstraction {
  return syncStateSchema({ ...graph, nodes: [...graph.nodes, node] });
}

export function removeNodes(graph: LangGraphAbstraction, ids: string[]): LangGraphAbstraction {
  const removed = new Set(ids);
  return syncStateSchema({
    ...graph,
    nodes: graph.nodes.filter((n) => !removed.has(n.id)),
    edges: graph.edges.filter((e) => !removed.has(e.source) && !removed.has(e.target)),
  });
}

export function removeEdges(graph: LangGraphAbstraction, ids: string[]): LangGraphAbstraction {
  const removed = new Set(ids);
  return { ...graph, edges: graph.edges.filter((e) => !removed.has(e.id)) };
}

export function updateNode(
  graph: LangGraphAbstraction,
  id: string,
  patch: Partial<Pick<GraphNode, "name" | "config" | "uiPosition">>,
): LangGraphAbstraction {
  const current = graph.nodes.find((n) => n.id === id);
  if (!current) return graph;

  let stateSchema = graph.stateSchema;
  const oldKey = current.config?.outputKey;
  const newKey = patch.config?.outputKey;
  if (
    typeof oldKey === "string" && typeof newKey === "string" && newKey &&
    oldKey !== newKey && stateSchema[oldKey] && !stateSchema[newKey]
  ) {
    stateSchema = { ...stateSchema, [newKey]: stateSchema[oldKey] };
  }

  return syncStateSchema({
    ...graph,
    stateSchema,
    nodes: graph.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
  });
}

export interface ConnectionLike {
  source: string;
  target: string;
  sourceHandle?: string | null;
}

export function isConnectionAllowed(graph: LangGraphAbstraction, c: ConnectionLike): boolean {
  if (c.source === c.target) return false;
  const source = graph.nodes.find((n) => n.id === c.source);
  const target = graph.nodes.find((n) => n.id === c.target);
  if (!source || !target) return false;
  if (source.type === "end" || target.type === "start") return false;
  return true;
}

export function connectNodes(graph: LangGraphAbstraction, c: ConnectionLike): LangGraphAbstraction {
  if (!isConnectionAllowed(graph, c)) return graph;
  const source = graph.nodes.find((n) => n.id === c.source)!;
  const isCondition = source.type === "condition";
  const path = isCondition ? (c.sourceHandle === "false" ? "false" : "true") : undefined;

  const duplicate = graph.edges.some(
    (e) => e.source === c.source && e.target === c.target && e.path === path,
  );
  if (duplicate) return graph;

  const edge: GraphEdge = {
    id: `edge_${c.source}_${c.target}${path ? `_${path}` : ""}`,
    source: c.source,
    target: c.target,
    isConditional: isCondition,
    ...(path ? { path } : {}),
  };

  const edges = isCondition
    ? graph.edges.filter((e) => !(e.source === c.source && e.path === path))
    : graph.edges;

  return { ...graph, edges: [...edges, edge] };
}

export function reconnectEdge(
  graph: LangGraphAbstraction,
  edgeId: string,
  c: ConnectionLike,
): LangGraphAbstraction {
  if (!graph.edges.some((e) => e.id === edgeId) || !isConnectionAllowed(graph, c)) return graph;
  return connectNodes(removeEdges(graph, [edgeId]), c);
}
