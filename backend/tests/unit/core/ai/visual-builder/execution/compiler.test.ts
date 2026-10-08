import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { buildStateSchema, compileGraph } from "../../../../../../core/ai/visual-builder/execution/compiler.ts";
import { LangGraphAbstraction, NodeRegistry } from "../../../../../../core/ai/visual-builder/types.ts";

function baseNodes() {
  return [
    { id: "start", name: "Start", type: "start" as const, config: {} },
    { id: "end", name: "End", type: "end" as const, config: {} },
  ];
}

Deno.test("buildStateSchema - overwrite (default) reducer takes the new value when defined", () => {
  const schema = buildStateSchema({ count: { type: "number", required: true } });
  const reducer = (schema.count.value as (a: unknown, b: unknown) => unknown);
  assertEquals(reducer(1, 2), 2);
  assertEquals(reducer(1, undefined), 1);
});

Deno.test("buildStateSchema - custom reducerStrategy is wired to the right function", () => {
  const schema = buildStateSchema({
    items: { type: "array", required: true, reducerStrategy: "append" },
  });
  const reducer = schema.items.value as (a: unknown[], b: unknown[]) => unknown[];
  assertEquals(reducer([1], [2]), [1, 2]);
});

Deno.test("buildStateSchema - a declared default is wired as a `default()` thunk returning that value", () => {
  const schema = buildStateSchema({ count: { type: "number", required: false, default: 42 } });
  assertEquals(typeof schema.count.default, "function");
  assertEquals(schema.count.default(), 42);
});

Deno.test("buildStateSchema - no declared default means no `default` key is added", () => {
  const schema = buildStateSchema({ count: { type: "number", required: false } });
  assertEquals("default" in schema.count, false);
});

Deno.test("compileGraph - throws when there is no start node", () => {
  const abstraction: LangGraphAbstraction = {
    nodes: [{ id: "end", name: "End", type: "end", config: {} }],
    edges: [],
    stateSchema: {},
  };
  assertThrows(
    () => compileGraph(abstraction, {}, {}),
    Error,
    "exactly one node of type 'start'",
  );
});

Deno.test("compileGraph - throws when there is no end node", () => {
  const abstraction: LangGraphAbstraction = {
    nodes: [{ id: "start", name: "Start", type: "start", config: {} }],
    edges: [],
    stateSchema: {},
  };
  assertThrows(
    () => compileGraph(abstraction, {}, {}),
    Error,
    "exactly one node of type 'end'",
  );
});

Deno.test("compileGraph - throws on duplicate node IDs", () => {
  const abstraction: LangGraphAbstraction = {
    nodes: [
      ...baseNodes(),
      { id: "dup", name: "A", type: "plugin", config: { pluginId: "noop" } },
      { id: "dup", name: "B", type: "plugin", config: { pluginId: "noop" } },
    ],
    edges: [],
    stateSchema: {},
  };
  assertThrows(() => compileGraph(abstraction, {}, {}), Error, "Duplicate node ID");
});

Deno.test("compileGraph - throws when a plugin node has no matching registry entry", () => {
  const abstraction: LangGraphAbstraction = {
    nodes: [...baseNodes(), { id: "n1", name: "Step", type: "plugin", config: { pluginId: "missing" } }],
    edges: [
      { id: "e1", source: "start", target: "n1", isConditional: false },
      { id: "e2", source: "n1", target: "end", isConditional: false },
    ],
    stateSchema: {},
  };
  const stateSchema = buildStateSchema({ dummy: { type: "string", required: false } });
  assertThrows(
    () => compileGraph(abstraction, stateSchema, {}),
    Error,
    "No executor found in registry",
  );
});

Deno.test("compileGraph - executes a simple linear plugin pipeline end to end", async () => {
  const registry: NodeRegistry = {
    "add-one": async (state) => ({ count: (state.count as number) + 1 }),
  };
  const abstraction: LangGraphAbstraction = {
    nodes: [
      ...baseNodes(),
      { id: "n1", name: "AddOne", type: "plugin", config: { pluginId: "add-one" } },
    ],
    edges: [
      { id: "e1", source: "start", target: "n1", isConditional: false },
      { id: "e2", source: "n1", target: "end", isConditional: false },
    ],
    stateSchema: {},
  };
  const stateSchema = buildStateSchema({ count: { type: "number", required: true } });
  const graph = compileGraph(abstraction, stateSchema, registry);

  const result = await graph.invoke({ count: 1 });
  assertEquals(result.count, 2);
});

Deno.test("compileGraph - a node executor error is wrapped with the node id", async () => {
  const registry: NodeRegistry = {
    boom: async () => {
      throw new Error("kaboom");
    },
  };
  const abstraction: LangGraphAbstraction = {
    nodes: [...baseNodes(), { id: "n1", name: "Boom", type: "plugin", config: { pluginId: "boom" } }],
    edges: [
      { id: "e1", source: "start", target: "n1", isConditional: false },
      { id: "e2", source: "n1", target: "end", isConditional: false },
    ],
    stateSchema: {},
  };
  const stateSchema = buildStateSchema({ dummy: { type: "string", required: false } });
  const graph = compileGraph(abstraction, stateSchema, registry);

  await assertRejects(() => graph.invoke({}), Error, "Node 'n1' failed: kaboom");
});

Deno.test("compileGraph - condition node routes to the 'true' branch when the field already satisfies the condition", async () => {
  const registry: NodeRegistry = {
    onTrue: async () => ({ visited: "true-branch" }),
    onFalse: async () => ({ visited: "false-branch" }),
  };
  const abstraction: LangGraphAbstraction = {
    nodes: [
      ...baseNodes(),
      {
        id: "cond",
        name: "Check",
        type: "condition",
        config: { condition: { field: "score", operator: "greater_than", value: 5 } },
      },
      { id: "t", name: "OnTrue", type: "plugin", config: { pluginId: "onTrue" } },
      { id: "f", name: "OnFalse", type: "plugin", config: { pluginId: "onFalse" } },
    ],
    edges: [
      { id: "e1", source: "start", target: "cond", isConditional: false },
      { id: "e2", source: "cond", target: "t", isConditional: true, path: "true" },
      { id: "e3", source: "cond", target: "f", isConditional: true, path: "false" },
      { id: "e4", source: "t", target: "end", isConditional: false },
      { id: "e5", source: "f", target: "end", isConditional: false },
    ],
    stateSchema: {},
  };
  const stateSchema = buildStateSchema({
    score: { type: "number", required: true },
    visited: { type: "string", required: false },
  });
  const graph = compileGraph(abstraction, stateSchema, registry);

  const result = await graph.invoke({ score: 10 });
  assertEquals(result.visited, "true-branch");
});

Deno.test("compileGraph - condition node routes to the 'false' branch when the condition is not satisfied", async () => {
  const registry: NodeRegistry = {
    onTrue: async () => ({ visited: "true-branch" }),
    onFalse: async () => ({ visited: "false-branch" }),
  };
  const abstraction: LangGraphAbstraction = {
    nodes: [
      ...baseNodes(),
      {
        id: "cond",
        name: "Check",
        type: "condition",
        config: { condition: { field: "score", operator: "greater_than", value: 5 } },
      },
      { id: "t", name: "OnTrue", type: "plugin", config: { pluginId: "onTrue" } },
      { id: "f", name: "OnFalse", type: "plugin", config: { pluginId: "onFalse" } },
    ],
    edges: [
      { id: "e1", source: "start", target: "cond", isConditional: false },
      { id: "e2", source: "cond", target: "t", isConditional: true, path: "true" },
      { id: "e3", source: "cond", target: "f", isConditional: true, path: "false" },
      { id: "e4", source: "t", target: "end", isConditional: false },
      { id: "e5", source: "f", target: "end", isConditional: false },
    ],
    stateSchema: {},
  };
  const stateSchema = buildStateSchema({
    score: { type: "number", required: true },
    visited: { type: "string", required: false },
  });
  const graph = compileGraph(abstraction, stateSchema, registry);

  const result = await graph.invoke({ score: 1 });
  assertEquals(result.visited, "false-branch");
});

Deno.test("compileGraph - plain edges with their own per-edge condition route by first match", async () => {
  const registry: NodeRegistry = {
    branchA: async () => ({ path: "A" }),
    branchB: async () => ({ path: "B" }),
    router: async (state) => state,
  };
  const abstraction: LangGraphAbstraction = {
    nodes: [
      ...baseNodes(),
      { id: "router", name: "Router", type: "plugin", config: { pluginId: "router" } },
      { id: "a", name: "A", type: "plugin", config: { pluginId: "branchA" } },
      { id: "b", name: "B", type: "plugin", config: { pluginId: "branchB" } },
    ],
    edges: [
      { id: "e1", source: "start", target: "router", isConditional: false },
      {
        id: "e2",
        source: "router",
        target: "a",
        isConditional: true,
        condition: { field: "kind", operator: "equals", value: "a" },
      },
      {
        id: "e3",
        source: "router",
        target: "b",
        isConditional: true,
        condition: { field: "kind", operator: "equals", value: "b" },
      },
      { id: "e4", source: "a", target: "end", isConditional: false },
      { id: "e5", source: "b", target: "end", isConditional: false },
    ],
    stateSchema: {},
  };
  const stateSchema = buildStateSchema({
    kind: { type: "string", required: true },
    path: { type: "string", required: false },
  });
  const graph = compileGraph(abstraction, stateSchema, registry);

  const result = await graph.invoke({ kind: "b" });
  assertEquals(result.path, "B");
});

Deno.test("compileGraph - a condition node whose field is already present in state is a no-op runtime step (does not need an LLM fallback)", async () => {
  const registry: NodeRegistry = {
    onTrue: async () => ({ visited: "true-branch" }),
    onFalse: async () => ({ visited: "false-branch" }),
  };
  const abstraction: LangGraphAbstraction = {
    nodes: [
      ...baseNodes(),
      {
        id: "cond",
        name: "Check",
        type: "condition",
        config: { condition: { field: "is_valid", operator: "equals", value: true } },
      },
      { id: "t", name: "OnTrue", type: "plugin", config: { pluginId: "onTrue" } },
      { id: "f", name: "OnFalse", type: "plugin", config: { pluginId: "onFalse" } },
    ],
    edges: [
      { id: "e1", source: "start", target: "cond", isConditional: false },
      { id: "e2", source: "cond", target: "t", isConditional: true, path: "true" },
      { id: "e3", source: "cond", target: "f", isConditional: true, path: "false" },
      { id: "e4", source: "t", target: "end", isConditional: false },
      { id: "e5", source: "f", target: "end", isConditional: false },
    ],
    stateSchema: {},
  };
  const stateSchema = buildStateSchema({
    is_valid: { type: "boolean", required: true },
    visited: { type: "string", required: false },
  });
  const graph = compileGraph(abstraction, stateSchema, registry);

  // is_valid is already set on the incoming state, so the condition node's
  // own runnable short-circuits to {} instead of invoking an LLM fallback —
  // only the conditional-edge routing (evaluateCondition) decides the branch.
  const result = await graph.invoke({ is_valid: true });
  assertEquals(result.visited, "true-branch");
});

Deno.test("compileGraph - a condition node with no condition.field configured is a no-op runtime step", async () => {
  const registry: NodeRegistry = {
    onTrue: async () => ({ visited: "true-branch" }),
  };
  const abstraction: LangGraphAbstraction = {
    nodes: [
      ...baseNodes(),
      { id: "cond", name: "Check", type: "condition", config: {} },
      { id: "t", name: "OnTrue", type: "plugin", config: { pluginId: "onTrue" } },
    ],
    edges: [
      { id: "e1", source: "start", target: "cond", isConditional: false },
      { id: "e2", source: "cond", target: "t", isConditional: true, path: "true" },
      { id: "e3", source: "t", target: "end", isConditional: false },
    ],
    stateSchema: {},
  };
  const stateSchema = buildStateSchema({ visited: { type: "string", required: false } });
  const graph = compileGraph(abstraction, stateSchema, registry);

  // No condition.field: the condition node's runnable returns {} immediately,
  // and the conditional-edge router (isMatch stays false) falls back to the
  // only available edge since there's no explicit "false" edge here.
  const result = await graph.invoke({});
  assertEquals(result.visited, "true-branch");
});

Deno.test("compileGraph - a plugin node executor is resolved by node.type when no pluginId-keyed entry exists in the registry", async () => {
  const registry: NodeRegistry = {
    // Keyed by node type ("plugin"), not by a specific pluginId.
    plugin: async () => ({ visited: true }),
  };
  const abstraction: LangGraphAbstraction = {
    nodes: [
      ...baseNodes(),
      { id: "n1", name: "Step", type: "plugin", config: { pluginId: "whatever-unregistered" } },
    ],
    edges: [
      { id: "e1", source: "start", target: "n1", isConditional: false },
      { id: "e2", source: "n1", target: "end", isConditional: false },
    ],
    stateSchema: {},
  };
  const stateSchema = buildStateSchema({ visited: { type: "boolean", required: false } });
  const graph = compileGraph(abstraction, stateSchema, registry);

  const result = await graph.invoke({});
  assertEquals(result.visited, true);
});

Deno.test("compileGraph - plain conditional edges with no matching condition throws", async () => {
  const registry: NodeRegistry = {
    router: async (state) => state,
    a: async () => ({}),
  };
  const abstraction: LangGraphAbstraction = {
    nodes: [
      ...baseNodes(),
      { id: "router", name: "Router", type: "plugin", config: { pluginId: "router" } },
      { id: "a", name: "A", type: "plugin", config: { pluginId: "a" } },
    ],
    edges: [
      { id: "e1", source: "start", target: "router", isConditional: false },
      {
        id: "e2",
        source: "router",
        target: "a",
        isConditional: true,
        condition: { field: "kind", operator: "equals", value: "never-matches" },
      },
      { id: "e3", source: "a", target: "end", isConditional: false },
    ],
    stateSchema: {},
  };
  const stateSchema = buildStateSchema({ kind: { type: "string", required: true } });
  const graph = compileGraph(abstraction, stateSchema, registry);

  await assertRejects(() => graph.invoke({ kind: "x" }), Error, "No matching conditional edge");
});
