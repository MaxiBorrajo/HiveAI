import type {
  LangGraphAbstraction,
  StatePropertyDefinition,
} from "./types.ts";
import { END_NODE_ID, START_NODE_ID } from "./constants.ts";

export function createBaseStateSchema(): Record<string, StatePropertyDefinition> {
  return {
    input: {
      type: "string",
      description: "User initial query or prompt for this execution",
      required: false,
    },
    cwd: {
      type: "string",
      description: "Current working directory / workspace path",
      required: false,
    },
    os: {
      type: "string",
      description: "Host operating system platform (e.g. linux, darwin, windows)",
      required: false,
    },
  };
}

export function createEmptyGraph(): LangGraphAbstraction {
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
    stateSchema: createBaseStateSchema(),
  };
}

export function syncStateSchema(graph: LangGraphAbstraction): LangGraphAbstraction {
  const schema = { ...createBaseStateSchema(), ...(graph.stateSchema ?? {}) };
  for (const node of graph.nodes) {
    const outputKey = node.config?.outputKey;
    if (typeof outputKey === "string" && outputKey && !schema[outputKey]) {
      schema[outputKey] = { type: "unknown", required: false };
    }
  }
  return { ...graph, stateSchema: schema };
}


export function createDraftGraph(
  currentGraph?: LangGraphAbstraction,
): LangGraphAbstraction {
  if (currentGraph) return JSON.parse(JSON.stringify(currentGraph));
  return { nodes: [], edges: [], stateSchema: createBaseStateSchema() };
}
