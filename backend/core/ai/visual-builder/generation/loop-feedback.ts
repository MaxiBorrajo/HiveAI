import type { GraphNode, LangGraphAbstraction } from "../types.ts";
import { findLoopBackEdgeIds } from "../execution/compiler.ts";

function reachableFrom(graph: LangGraphAbstraction, startId: string): Set<string> {
  const seen = new Set<string>();
  const stack = [startId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const e of graph.edges) {
      if (e.source === id && !seen.has(e.target)) {
        seen.add(e.target);
        stack.push(e.target);
      }
    }
  }
  return seen;
}

/**
 * A critique node on a condition's retry path writes the issues to fix, but the nodes it
 * sends the flow back to only see it if it is in their inputMapping. Wire it into every
 * LLM node of the retry cycle (except the judge itself). Returns the nodes that changed.
 */
export function wireLoopFeedback(graph: LangGraphAbstraction): GraphNode[] {
  const loopBackIds = findLoopBackEdgeIds(graph);
  const conditionIds = new Set(
    graph.nodes.filter((n) => n.type === "condition").map((n) => n.id),
  );
  const updated = new Map<string, GraphNode>();

  for (const critique of graph.nodes) {
    const key = critique.config?.outputKey as string | undefined;
    if (critique.type !== "llm" || !key) continue;
    const retryEdge = graph.edges.find(
      (e) =>
        e.target === critique.id &&
        conditionIds.has(e.source) &&
        e.path === "false" &&
        loopBackIds.has(e.id),
    );
    if (!retryEdge) continue;

    const downstream = reachableFrom(graph, critique.id);
    for (const node of graph.nodes) {
      if (node.type !== "llm" || node.id === critique.id) continue;
      if (!downstream.has(node.id)) continue;
      if (!reachableFrom(graph, node.id).has(retryEdge.source)) continue;
      const isJudge = graph.edges.some(
        (e) => e.source === node.id && conditionIds.has(e.target),
      );
      if (isJudge) continue;

      const mapping = (node.config.inputMapping ?? {}) as Record<string, string>;
      if (Object.values(mapping).includes(key)) continue;
      node.config.inputMapping = { ...mapping, [key]: key };
      updated.set(node.id, node);
    }

    const def = graph.stateSchema?.[key];
    if (def && def.default === undefined && !def.required) def.default = "";
  }
  return [...updated.values()];
}
