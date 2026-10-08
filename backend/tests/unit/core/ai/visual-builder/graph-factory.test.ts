import { assertEquals } from "@std/assert";
import {
  createBaseStateSchema,
  createEmptyGraph,
  syncStateSchema,
  createDraftGraph,
} from "../../../../../core/ai/visual-builder/graph-factory.ts";
import { START_NODE_ID, END_NODE_ID } from "../../../../../core/ai/visual-builder/constants.ts";
import type { LangGraphAbstraction } from "../../../../../core/ai/visual-builder/types.ts";

// --- createBaseStateSchema ---

Deno.test("createBaseStateSchema - always includes input, cwd and os as optional string fields", () => {
  const schema = createBaseStateSchema();
  assertEquals(Object.keys(schema).sort(), ["cwd", "input", "os"]);
  for (const key of ["input", "cwd", "os"]) {
    assertEquals(schema[key].type, "string");
    assertEquals(schema[key].required, false);
  }
});

Deno.test("createBaseStateSchema - returns a fresh object each call (not a shared reference)", () => {
  const a = createBaseStateSchema();
  const b = createBaseStateSchema();
  a.input.type = "number" as any;
  assertEquals(b.input.type, "string");
});

// --- createEmptyGraph ---

Deno.test("createEmptyGraph - has exactly a start and an end node, no edges", () => {
  const graph = createEmptyGraph();
  assertEquals(graph.nodes.length, 2);
  assertEquals(graph.nodes[0].id, START_NODE_ID);
  assertEquals(graph.nodes[0].type, "start");
  assertEquals(graph.nodes[1].id, END_NODE_ID);
  assertEquals(graph.nodes[1].type, "end");
  assertEquals(graph.edges, []);
});

Deno.test("createEmptyGraph - the end node defaults to a markdown output spec with empty summary/contentKey", () => {
  const graph = createEmptyGraph();
  assertEquals(graph.nodes[1].config.output, {
    type: "markdown",
    summary: "",
    contentKey: "",
  });
});

Deno.test("createEmptyGraph - stateSchema matches createBaseStateSchema", () => {
  const graph = createEmptyGraph();
  assertEquals(graph.stateSchema, createBaseStateSchema());
});

// --- syncStateSchema ---

Deno.test("syncStateSchema - merges in the base schema keys if missing", () => {
  const graph: LangGraphAbstraction = { nodes: [], edges: [], stateSchema: {} };
  const synced = syncStateSchema(graph);
  assertEquals(Object.keys(synced.stateSchema).sort(), ["cwd", "input", "os"]);
});

Deno.test("syncStateSchema - preserves existing custom stateSchema entries", () => {
  const graph: LangGraphAbstraction = {
    nodes: [],
    edges: [],
    stateSchema: { custom_var: { type: "number", required: true } },
  };
  const synced = syncStateSchema(graph);
  assertEquals(synced.stateSchema.custom_var, { type: "number", required: true });
});

Deno.test("syncStateSchema - adds a schema entry for every node outputKey not already present", () => {
  const graph: LangGraphAbstraction = {
    nodes: [
      { id: "n1", name: "N1", type: "plugin", config: { outputKey: "search_results" } },
    ],
    edges: [],
    stateSchema: {},
  };
  const synced = syncStateSchema(graph);
  assertEquals(synced.stateSchema.search_results, { type: "unknown", required: false });
});

Deno.test("syncStateSchema - does not overwrite an outputKey that already has a declared type", () => {
  const graph: LangGraphAbstraction = {
    nodes: [
      { id: "n1", name: "N1", type: "plugin", config: { outputKey: "score" } },
    ],
    edges: [],
    stateSchema: { score: { type: "number", required: true } },
  };
  const synced = syncStateSchema(graph);
  assertEquals(synced.stateSchema.score, { type: "number", required: true });
});

Deno.test("syncStateSchema - a node with no outputKey (or a non-string one) does not add a schema entry", () => {
  const graph: LangGraphAbstraction = {
    nodes: [
      { id: "n1", name: "N1", type: "start", config: {} },
      { id: "n2", name: "N2", type: "plugin", config: { outputKey: "" } },
    ],
    edges: [],
    stateSchema: {},
  };
  const synced = syncStateSchema(graph);
  assertEquals(Object.keys(synced.stateSchema).sort(), ["cwd", "input", "os"]);
});

Deno.test("syncStateSchema - returns a new graph object, does not mutate the input", () => {
  const graph: LangGraphAbstraction = { nodes: [], edges: [], stateSchema: {} };
  const synced = syncStateSchema(graph);
  assertEquals(synced === graph, false);
  assertEquals(graph.stateSchema, {});
});

// --- createDraftGraph ---

Deno.test("createDraftGraph - with no argument, returns an empty graph (no nodes/edges) with the base schema", () => {
  const draft = createDraftGraph();
  assertEquals(draft.nodes, []);
  assertEquals(draft.edges, []);
  assertEquals(draft.stateSchema, createBaseStateSchema());
});

Deno.test("createDraftGraph - given a currentGraph, returns a deep clone of it", () => {
  const current: LangGraphAbstraction = {
    nodes: [{ id: "n1", name: "N1", type: "plugin", config: { nested: { a: 1 } } }],
    edges: [],
    stateSchema: {},
  };
  const draft = createDraftGraph(current);
  assertEquals(draft, current);
  assertEquals(draft === current, false);
  assertEquals(draft.nodes[0] === current.nodes[0], false);

  // Mutating the clone must not affect the original (proves it's a deep clone).
  (draft.nodes[0].config.nested as any).a = 999;
  assertEquals((current.nodes[0].config.nested as any).a, 1);
});
