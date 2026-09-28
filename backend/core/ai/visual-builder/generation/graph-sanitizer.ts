import { GraphEdge, GraphNode } from "../types.ts";

// The 7 deterministic graph-integrity invariants enforced after Phase 1's
// topology skeleton is normalized into real nodes/edges, and before Phase 2
// configures each node. Each function is pure over (intermediateNodes,
// rawEdges) and returns the edge list to continue with — mirroring the
// exact logic and log messages that used to live inline in generator.ts.

// 1. Invariant: Start must have at least one outgoing edge
export function ensureStartHasOutgoingEdge(
  intermediateNodes: GraphNode[],
  rawEdges: GraphEdge[],
): GraphEdge[] {
  if (!rawEdges.some((e) => e.source === "start") && intermediateNodes.length > 0) {
    rawEdges.unshift({
      id: `edge_start_${intermediateNodes[0].id}`,
      source: "start",
      target: intermediateNodes[0].id,
      isConditional: false,
    });
  }
  return rawEdges;
}

// 2. Invariant: Every intermediate node must have at least one incoming edge (No orphan nodes)
export function ensureNoOrphanNodes(
  intermediateNodes: GraphNode[],
  rawEdges: GraphEdge[],
): GraphEdge[] {
  for (let i = 0; i < intermediateNodes.length; i++) {
    const node = intermediateNodes[i];
    const hasIncoming = rawEdges.some((e) => e.target === node.id);
    if (!hasIncoming) {
      const prevId = i === 0 ? "start" : intermediateNodes[i - 1].id;
      console.log(
        `[Visual Builder - Generator] Deterministic code: Auto-connecting orphan node "${node.id}" from "${prevId}"`,
      );
      rawEdges.push({
        id: `edge_${prevId}_${node.id}`,
        source: prevId,
        target: node.id,
        isConditional: false,
      });
    }
  }
  return rawEdges;
}

// 3. Invariant: Every intermediate node must have at least one outgoing edge (No dead-ends)
// A dead-end node defaults to connecting straight to "end" — NOT to "the next
// node in array order". Two condition branches are commonly adjacent in that
// array (e.g. the "false" branch's last node sitting right before the "true"
// branch's first node), so connecting-to-next-in-array silently fuses two
// branches that must stay independent until "end". Only fall back to another
// intermediate node when there is no condition node anywhere in the graph
// (a simple linear pipeline, where "next in array" is an unambiguous guess).
export function ensureNoDeadEnds(
  intermediateNodes: GraphNode[],
  rawEdges: GraphEdge[],
): GraphEdge[] {
  const hasAnyCondition = intermediateNodes.some((n) => n.type === "condition");
  for (let i = 0; i < intermediateNodes.length; i++) {
    const node = intermediateNodes[i];
    const hasOutgoing = rawEdges.some((e) => e.source === node.id);
    if (!hasOutgoing) {
      const nextId =
        !hasAnyCondition && i < intermediateNodes.length - 1
          ? intermediateNodes[i + 1].id
          : "end";
      console.log(
        `[Visual Builder - Generator] Deterministic code: Auto-connecting dead-end node "${node.id}" to "${nextId}"`,
      );
      rawEdges.push({
        id: `edge_${node.id}_${nextId}`,
        source: node.id,
        target: nextId,
        isConditional: node.type === "condition",
        path: node.type === "condition" ? "true" : undefined,
      });
    }
  }
  return rawEdges;
}

// 4. Invariant: Condition Nodes must have EXACTLY ONE "true" and EXACTLY ONE "false" path
export function ensureConditionBranchesComplete(
  intermediateNodes: GraphNode[],
  rawEdges: GraphEdge[],
): GraphEdge[] {
  for (const cn of intermediateNodes.filter((n) => n.type === "condition")) {
    const cnIndex = intermediateNodes.findIndex((n) => n.id === cn.id);

    // Any edge pointing backwards to an earlier node is inherently a loopback/retry branch
    for (const e of rawEdges.filter((edge) => edge.source === cn.id)) {
      const targetIndex = intermediateNodes.findIndex((n) => n.id === e.target);
      if (targetIndex !== -1 && targetIndex < cnIndex) {
        e.path = "false";
        e.isConditional = true;
      }
    }

    let fromCn = rawEdges.filter((e) => e.source === cn.id);
    let trueEdges = fromCn.filter((e) => e.path === "true");
    let falseEdges = fromCn.filter((e) => e.path === "false");

    // If multiple true edges exist and no false edge, convert backward/alternative edge to false
    if (trueEdges.length > 1 && falseEdges.length === 0) {
      const backward = trueEdges.find((e) => {
        const targetIndex = intermediateNodes.findIndex((n) => n.id === e.target);
        return targetIndex !== -1 && targetIndex < cnIndex;
      });
      if (backward) {
        backward.path = "false";
      } else {
        trueEdges[1].path = "false";
      }
      fromCn = rawEdges.filter((e) => e.source === cn.id);
      trueEdges = fromCn.filter((e) => e.path === "true");
      falseEdges = fromCn.filter((e) => e.path === "false");
    }

    // Strictly enforce at most ONE true edge
    if (trueEdges.length > 1) {
      for (const rem of trueEdges.slice(1)) {
        const idx = rawEdges.indexOf(rem);
        if (idx !== -1) rawEdges.splice(idx, 1);
      }
    }

    // Strictly enforce at most ONE false edge
    if (falseEdges.length > 1) {
      for (const rem of falseEdges.slice(1)) {
        const idx = rawEdges.indexOf(rem);
        if (idx !== -1) rawEdges.splice(idx, 1);
      }
    }

    // If missing true branch, add exactly one forward
    if (!rawEdges.some((e) => e.source === cn.id && e.path === "true")) {
      const unlinked = intermediateNodes.find(
        (n, idx) => n.id !== cn.id && idx > cnIndex && !rawEdges.some((e) => e.target === n.id),
      );
      const target = unlinked ? unlinked.id : "end";
      rawEdges.push({
        id: `edge_${cn.id}_${target}_true`,
        source: cn.id,
        target,
        isConditional: true,
        path: "true",
      });
    }

    // If missing false branch, add exactly one backward or alternative
    if (!rawEdges.some((e) => e.source === cn.id && e.path === "false")) {
      const loopTarget = intermediateNodes.find(
        (n, idx) => n.id !== cn.id && n.type !== "condition" && idx < cnIndex,
      );
      const target = loopTarget ? loopTarget.id : "end";
      rawEdges.push({
        id: `edge_${cn.id}_${target}_false`,
        source: cn.id,
        target,
        isConditional: true,
        path: "false",
      });
    }
  }
  return rawEdges;
}

// 4.5. Invariant: A condition's two branches must not converge into each other
// before "end". A common LLM/heuristic mistake is wiring the tail of the
// "false" branch into the middle of the "true" branch (or vice versa) —
// e.g. "no vulnerability -> generate certificate -> [wrongly feeds into]
// -> process CVE advisory", silently merging two paths that must stay
// independent. Detect any node reachable from BOTH branches of the same
// condition (without going through "end" first) and cut the edge that
// creates the cross-branch merge, reconnecting that branch's tail to "end".
export function ensureBranchesDoNotConverge(
  intermediateNodes: GraphNode[],
  rawEdges: GraphEdge[],
): GraphEdge[] {
  const reachableWithoutEnd = (startId: string): Set<string> => {
    const seen = new Set<string>();
    const stack = [startId];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (cur === "end" || seen.has(cur)) continue;
      seen.add(cur);
      for (const e of rawEdges.filter((edge) => edge.source === cur)) {
        stack.push(e.target);
      }
    }
    return seen;
  };

  // Whether following edges forward from startId can ever reach targetId again
  // WITHOUT going through "end" — used to detect a branch that cycles back
  // (directly or through other nodes/conditions) rather than one that goes
  // straight through to a distinct downstream destination.
  const canCycleBackTo = (startId: string, targetId: string): boolean => {
    const seen = new Set<string>();
    const stack = [startId];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (cur === "end" || seen.has(cur)) continue;
      seen.add(cur);
      if (cur === targetId) return true;
      for (const e of rawEdges.filter((edge) => edge.source === cur)) {
        stack.push(e.target);
      }
    }
    return false;
  };

  for (const cn of intermediateNodes.filter((n) => n.type === "condition")) {
    const trueEdge = rawEdges.find((e) => e.source === cn.id && e.path === "true");
    const falseEdge = rawEdges.find((e) => e.source === cn.id && e.path === "false");
    if (!trueEdge || !falseEdge || trueEdge.target === falseEdge.target) continue;

    // A branch that eventually cycles back to THIS condition node (a legitimate
    // retry loop, however many nodes/conditions it passes through on the way)
    // will, by construction, reach everything downstream of this condition
    // again — including whatever the OTHER branch reaches. That overlap is an
    // intentional loop, not a bug. Only treat a branch as a real forward path
    // (subject to the merge check below) when it does NOT cycle back here.
    const trueIsLoopback = canCycleBackTo(trueEdge.target, cn.id);
    const falseIsLoopback = canCycleBackTo(falseEdge.target, cn.id);
    if (trueIsLoopback || falseIsLoopback) continue;

    const trueReachable = reachableWithoutEnd(trueEdge.target);
    const falseReachable = reachableWithoutEnd(falseEdge.target);
    const overlap = [...trueReachable].filter((id) => falseReachable.has(id));
    if (overlap.length === 0) continue;

    // The branches merge at the first shared node. Find whichever branch's
    // edge INTO that shared node should be cut: prefer cutting the edge from
    // a node that ALSO already has another edge to "end" or is a tail node,
    // otherwise just cut the false branch's incoming edge into the merge
    // point (the "false"/approved path is the one most often meant to end
    // independently) and reconnect that tail to "end".
    for (const mergeNodeId of overlap) {
      const incomingFromFalseSide = rawEdges.find(
        (e) => e.target === mergeNodeId && falseReachable.has(e.source) && e.source !== mergeNodeId,
      );
      const cutEdge = incomingFromFalseSide;
      if (!cutEdge) continue;

      const idx = rawEdges.indexOf(cutEdge);
      if (idx === -1) continue;
      console.log(
        `[Visual Builder - Generator] Deterministic code: Condition "${cn.id}"'s branches converge at "${mergeNodeId}" — cutting edge "${cutEdge.source}" -> "${cutEdge.target}" and reconnecting "${cutEdge.source}" to "end".`,
      );
      rawEdges.splice(idx, 1);
      if (!rawEdges.some((e) => e.source === cutEdge.source)) {
        rawEdges.push({
          id: `edge_${cutEdge.source}_end_branch_split`,
          source: cutEdge.source,
          target: "end",
          isConditional: false,
        });
      }
      break; // one merge fixed per condition node is enough; re-derive on next loop iteration if needed
    }
  }
  return rawEdges;
}

// 5. Invariant: Loop Termination & Reachability to "end" (Prevent infinite loops)
// Ensure every node has an executable path to "end"
export function ensureAllNodesReachEnd(
  intermediateNodes: GraphNode[],
  rawEdges: GraphEdge[],
): GraphEdge[] {
  const canReachEnd = (startNodeId: string, visited = new Set<string>()): boolean => {
    if (startNodeId === "end") return true;
    if (visited.has(startNodeId)) return false; // Cycle detected along this path
    visited.add(startNodeId);
    const outgoing = rawEdges.filter((e) => e.source === startNodeId);
    return outgoing.some((e) => canReachEnd(e.target, new Set(visited)));
  };

  for (const node of intermediateNodes) {
    if (!canReachEnd(node.id)) {
      console.log(
        `[Visual Builder - Generator] Deterministic code: Node "${node.id}" cannot reach "end" (cycle or dead path detected). Adding termination edge to "end".`,
      );
      rawEdges.push({
        id: `edge_${node.id}_end_exit`,
        source: node.id,
        target: "end",
        isConditional: node.type === "condition",
        path: node.type === "condition" ? "true" : undefined,
      });
    }
  }
  return rawEdges;
}

// 6. Invariant: Deduplicate edges
export function deduplicateEdges(rawEdges: GraphEdge[]): GraphEdge[] {
  const seenEdges = new Set<string>();
  const sanitizedEdges: GraphEdge[] = [];
  for (const e of rawEdges) {
    const key = `${e.source}->${e.target}:${e.path || ""}`;
    if (!seenEdges.has(key)) {
      seenEdges.add(key);
      sanitizedEdges.push(e);
    }
  }
  return sanitizedEdges;
}

/**
 * Applies all 7 deterministic graph-integrity invariants, in order, to the
 * raw edges produced from the Phase 1 skeleton. Order matters — e.g.
 * dead-ends must be resolved before branch-convergence/reachability checks
 * can meaningfully run.
 */
export function sanitizeGraphEdges(
  intermediateNodes: GraphNode[],
  rawEdges: GraphEdge[],
): GraphEdge[] {
  let edges = rawEdges;
  edges = ensureStartHasOutgoingEdge(intermediateNodes, edges);
  edges = ensureNoOrphanNodes(intermediateNodes, edges);
  edges = ensureNoDeadEnds(intermediateNodes, edges);
  edges = ensureConditionBranchesComplete(intermediateNodes, edges);
  edges = ensureBranchesDoNotConverge(intermediateNodes, edges);
  edges = ensureAllNodesReachEnd(intermediateNodes, edges);
  edges = deduplicateEdges(edges);
  return edges;
}
