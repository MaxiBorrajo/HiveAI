import { assertEquals } from "@std/assert";
import { findSkeletonShapeViolations } from "./skeleton-validator.ts";
import { WorkflowSkeleton } from "../types.ts";

function skeleton(overrides: Partial<WorkflowSkeleton>): WorkflowSkeleton {
  return { nodes: [], edges: [], ...overrides } as WorkflowSkeleton;
}

Deno.test("findSkeletonShapeViolations - plugin node without pluginId is flagged", () => {
  const s = skeleton({
    nodes: [{ id: "n1", name: "Search", type: "plugin" } as any],
  });
  const violations = findSkeletonShapeViolations(s);
  assertEquals(violations.some((v) => v.field === "pluginId"), true);
});

Deno.test("findSkeletonShapeViolations - plugin node with 'plugins' array is flagged", () => {
  const s = skeleton({
    nodes: [
      { id: "n1", name: "Search", type: "plugin", pluginId: "web-search", plugins: ["extra"] } as any,
    ],
  });
  const violations = findSkeletonShapeViolations(s);
  assertEquals(violations.some((v) => v.field === "plugins"), true);
});

Deno.test("findSkeletonShapeViolations - well-formed plugin node passes", () => {
  const s = skeleton({
    nodes: [{ id: "n1", name: "Search", type: "plugin", pluginId: "web-search" } as any],
  });
  assertEquals(findSkeletonShapeViolations(s).length, 0);
});

Deno.test("findSkeletonShapeViolations - llm node with pluginId set is flagged", () => {
  const s = skeleton({
    nodes: [{ id: "n1", name: "Agent", type: "llm", pluginId: "web-search" } as any],
  });
  const violations = findSkeletonShapeViolations(s);
  assertEquals(violations.some((v) => v.field === "pluginId"), true);
});

Deno.test("findSkeletonShapeViolations - condition node with pluginId or plugins is flagged", () => {
  const s = skeleton({
    nodes: [{ id: "n1", name: "Check", type: "condition", pluginId: "x" } as any],
  });
  const violations = findSkeletonShapeViolations(s);
  assertEquals(violations.some((v) => v.kind === "invalid_node_shape"), true);
});

Deno.test("findSkeletonShapeViolations - edge from condition node missing 'path' is flagged", () => {
  const s = skeleton({
    nodes: [{ id: "cond", name: "Check", type: "condition" } as any],
    edges: [{ id: "e1", source: "cond", target: "end" } as any],
  });
  const violations = findSkeletonShapeViolations(s);
  assertEquals(violations.some((v) => v.kind === "condition_edge_missing_path"), true);
});

Deno.test("findSkeletonShapeViolations - edge from condition node with path set passes", () => {
  const s = skeleton({
    nodes: [{ id: "cond", name: "Check", type: "condition" } as any],
    edges: [{ id: "e1", source: "cond", target: "end", path: "true" } as any],
  });
  assertEquals(
    findSkeletonShapeViolations(s).filter((v) => v.kind === "condition_edge_missing_path").length,
    0,
  );
});

Deno.test("findSkeletonShapeViolations - edges from non-condition sources don't require a path", () => {
  const s = skeleton({
    nodes: [{ id: "n1", name: "Step", type: "llm" } as any],
    edges: [{ id: "e1", source: "n1", target: "end" } as any],
  });
  assertEquals(findSkeletonShapeViolations(s).length, 0);
});
