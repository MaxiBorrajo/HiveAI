import { assertEquals } from "@std/assert";
import {
  ensureStartHasOutgoingEdge,
  ensureNoOrphanNodes,
  ensureNoDeadEnds,
  pruneDuplicateConditionBranches,
  findMissingConditionBranches,
  fillMissingConditionBranches,
  findConvergingConditionBranches,
  ensureAllNodesReachEnd,
  deduplicateEdges,
  sanitizeGraphEdges,
} from "../../../../../../core/ai/visual-builder/generation/graph-sanitizer.ts";
import { GraphEdge, GraphNode } from "../../../../../../core/ai/visual-builder/types.ts";

function n(id: string, type: GraphNode["type"] = "llm"): GraphNode {
  return { id, name: id, type, config: {} };
}

function e(source: string, target: string, extra: Partial<GraphEdge> = {}): GraphEdge {
  return { id: `${source}->${target}`, source, target, isConditional: false, ...extra };
}

Deno.test("ensureStartHasOutgoingEdge - adds edge from start to first node when missing", () => {
  const nodes = [n("a"), n("b")];
  const edges = ensureStartHasOutgoingEdge(nodes, []);
  assertEquals(edges.length, 1);
  assertEquals(edges[0].source, "start");
  assertEquals(edges[0].target, "a");
});

Deno.test("ensureStartHasOutgoingEdge - does nothing if start already has an outgoing edge", () => {
  const nodes = [n("a")];
  const existing = [e("start", "a")];
  const edges = ensureStartHasOutgoingEdge(nodes, existing);
  assertEquals(edges.length, 1);
});

Deno.test("ensureStartHasOutgoingEdge - no-op with no intermediate nodes", () => {
  const edges = ensureStartHasOutgoingEdge([], []);
  assertEquals(edges.length, 0);
});

Deno.test("ensureNoOrphanNodes - connects an orphan node from the previous node in sequence", () => {
  const nodes = [n("a"), n("b")];
  const edges = ensureNoOrphanNodes(nodes, [e("start", "a")]);
  const orphanFix = edges.find((ed) => ed.target === "b");
  assertEquals(orphanFix?.source, "a");
});

Deno.test("ensureNoOrphanNodes - first node with no incoming edge connects from start", () => {
  const nodes = [n("a")];
  const edges = ensureNoOrphanNodes(nodes, []);
  assertEquals(edges[0].source, "start");
  assertEquals(edges[0].target, "a");
});

Deno.test("ensureNoDeadEnds - connects a dead-end node to the next node in sequence", () => {
  const nodes = [n("a"), n("b")];
  const edges = ensureNoDeadEnds(nodes, [e("start", "a")]);
  const fix = edges.find((ed) => ed.source === "a");
  assertEquals(fix?.target, "b");
});

Deno.test("ensureNoDeadEnds - last node with no outgoing edge connects to end", () => {
  const nodes = [n("a")];
  const edges = ensureNoDeadEnds(nodes, []);
  assertEquals(edges[0].target, "end");
});

Deno.test("ensureNoDeadEnds - condition node dead-end gets a 'true' path to end", () => {
  const nodes = [n("cond", "condition")];
  const edges = ensureNoDeadEnds(nodes, []);
  assertEquals(edges[0].target, "end");
  assertEquals(edges[0].path, "true");
  assertEquals(edges[0].isConditional, true);
});

Deno.test("ensureNoDeadEnds - if any condition node exists, dangling nodes go straight to end (no chaining)", () => {
  const nodes = [n("a"), n("cond", "condition"), n("b")];
  const edges = ensureNoDeadEnds(nodes, [e("start", "a"), e("a", "cond")]);
  const aFix = edges.find((ed) => ed.source === "a" && ed.target !== "cond");
  const bFix = edges.find((ed) => ed.source === "b");
  assertEquals(bFix?.target, "end");
});

Deno.test("pruneDuplicateConditionBranches - keeps only the first true and first false edge", () => {
  const nodes = [n("cond", "condition")];
  const edges = [
    e("cond", "a", { path: "true", isConditional: true }),
    e("cond", "b", { path: "true", isConditional: true }),
    e("cond", "c", { path: "false", isConditional: true }),
  ];
  const result = pruneDuplicateConditionBranches(nodes, edges);
  assertEquals(result.filter((ed) => ed.path === "true").length, 1);
  assertEquals(result.filter((ed) => ed.path === "false").length, 1);
  assertEquals(result.find((ed) => ed.path === "true")?.target, "a");
});

Deno.test("findMissingConditionBranches - flags missing true and false branches separately", () => {
  const nodes = [n("cond", "condition")];
  const violations = findMissingConditionBranches(nodes, []);
  assertEquals(violations.length, 2);
  assertEquals(violations.map((v) => v.field).sort(), ["false", "true"]);
});

Deno.test("findMissingConditionBranches - no violations when both branches exist", () => {
  const nodes = [n("cond", "condition")];
  const edges = [
    e("cond", "a", { path: "true", isConditional: true }),
    e("cond", "b", { path: "false", isConditional: true }),
  ];
  assertEquals(findMissingConditionBranches(nodes, edges).length, 0);
});

Deno.test("fillMissingConditionBranches - fills true branch to an unlinked downstream node", () => {
  const nodes = [n("cond", "condition"), n("a")];
  const edges = fillMissingConditionBranches(nodes, []);
  const trueEdge = edges.find((ed) => ed.path === "true");
  assertEquals(trueEdge?.target, "a");
});

Deno.test("fillMissingConditionBranches - false branch loops back to an earlier non-condition node, else end", () => {
  const nodes = [n("a"), n("cond", "condition")];
  const edges = fillMissingConditionBranches(nodes, []);
  const falseEdge = edges.find((ed) => ed.path === "false");
  assertEquals(falseEdge?.target, "a");
});

Deno.test("fillMissingConditionBranches - false branch defaults to end with no earlier node", () => {
  const nodes = [n("cond", "condition")];
  const edges = fillMissingConditionBranches(nodes, []);
  const falseEdge = edges.find((ed) => ed.path === "false");
  assertEquals(falseEdge?.target, "end");
});

Deno.test("findConvergingConditionBranches - flags when true/false branches target the same node", () => {
  const nodes = [n("cond", "condition")];
  const edges = [
    e("cond", "same", { path: "true", isConditional: true }),
    e("cond", "same", { path: "false", isConditional: true }),
  ];
  const violations = findConvergingConditionBranches(nodes, edges);
  assertEquals(violations.length, 1);
  assertEquals(violations[0].kind, "condition_branches_converge");
});

Deno.test("findConvergingConditionBranches - no violation when branches differ", () => {
  const nodes = [n("cond", "condition")];
  const edges = [
    e("cond", "a", { path: "true", isConditional: true }),
    e("cond", "b", { path: "false", isConditional: true }),
  ];
  assertEquals(findConvergingConditionBranches(nodes, edges).length, 0);
});

Deno.test("ensureAllNodesReachEnd - breaks a 2-node cycle by adding one termination edge to end", () => {
  const nodes = [n("a"), n("b")];
  const edges = [e("a", "b"), e("b", "a")];
  const result = ensureAllNodesReachEnd(nodes, edges);
  const terminations = result.filter((ed) => ed.target === "end");
  assertEquals(terminations.length, 1);
  assertEquals(terminations[0].source, "a");
});

Deno.test("ensureAllNodesReachEnd - no changes when a path to end already exists", () => {
  const nodes = [n("a")];
  const edges = [e("a", "end")];
  const result = ensureAllNodesReachEnd(nodes, edges);
  assertEquals(result.length, 1);
});

Deno.test("deduplicateEdges - removes exact source->target:path duplicates", () => {
  const edges = [e("a", "b"), e("a", "b"), e("a", "c")];
  const result = deduplicateEdges(edges);
  assertEquals(result.length, 2);
});

Deno.test("deduplicateEdges - keeps edges with the same source/target but different path", () => {
  const edges = [
    e("a", "b", { path: "true" }),
    e("a", "b", { path: "false" }),
  ];
  assertEquals(deduplicateEdges(edges).length, 2);
});

Deno.test("sanitizeGraphEdges - produces a fully connected graph from a bare node list", () => {
  const nodes = [n("a"), n("b"), n("c")];
  const edges = sanitizeGraphEdges(nodes, []);

  assertEquals(edges.some((ed) => ed.source === "start" && ed.target === "a"), true);
  assertEquals(edges.some((ed) => ed.source === "a" && ed.target === "b"), true);
  assertEquals(edges.some((ed) => ed.source === "b" && ed.target === "c"), true);
  assertEquals(edges.some((ed) => ed.source === "c" && ed.target === "end"), true);
});

Deno.test("sanitizeGraphEdges - is idempotent when run on already-sane edges", () => {
  const nodes = [n("a")];
  const edges = [e("start", "a"), e("a", "end")];
  const result = sanitizeGraphEdges(nodes, edges);
  assertEquals(result.length, 2);
});
