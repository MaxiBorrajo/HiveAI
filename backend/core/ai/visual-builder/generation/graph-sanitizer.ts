import { GraphEdge, GraphNode, InputMappingViolation } from "../types.ts";

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

export function pruneDuplicateConditionBranches(
  intermediateNodes: GraphNode[],
  rawEdges: GraphEdge[],
): GraphEdge[] {
  for (const cn of intermediateNodes.filter((n) => n.type === "condition")) {
    const fromCn = rawEdges.filter((e) => e.source === cn.id);
    const trueEdges = fromCn.filter((e) => e.path === "true");
    const falseEdges = fromCn.filter((e) => e.path === "false");

    for (const rem of [...trueEdges.slice(1), ...falseEdges.slice(1)]) {
      const idx = rawEdges.indexOf(rem);
      if (idx !== -1) rawEdges.splice(idx, 1);
    }
  }
  return rawEdges;
}

export function findMissingConditionBranches(
  intermediateNodes: GraphNode[],
  rawEdges: GraphEdge[],
): InputMappingViolation[] {
  const violations: InputMappingViolation[] = [];

  for (const cn of intermediateNodes.filter((n) => n.type === "condition")) {
    const fromCn = rawEdges.filter((e) => e.source === cn.id);
    const hasTrue = fromCn.some((e) => e.path === "true");
    const hasFalse = fromCn.some((e) => e.path === "false");

    if (!hasTrue) {
      violations.push({
        kind: "missing_condition_branch",
        nodeId: cn.id,
        nodeName: cn.name,
        field: "true",
        invalidValue: "",
        reason: `condition node "${cn.id}" ("${cn.name}") has no "true" branch edge. Add an edge from "${cn.id}" with path "true".`,
      });
    }
    if (!hasFalse) {
      violations.push({
        kind: "missing_condition_branch",
        nodeId: cn.id,
        nodeName: cn.name,
        field: "false",
        invalidValue: "",
        reason: `condition node "${cn.id}" ("${cn.name}") has no "false" branch edge. Add an edge from "${cn.id}" with path "false" (e.g. looping back to an earlier node to retry, or ending the workflow).`,
      });
    }
  }

  return violations;
}


export function fillMissingConditionBranches(
  intermediateNodes: GraphNode[],
  rawEdges: GraphEdge[],
): GraphEdge[] {
  for (const cn of intermediateNodes.filter((n) => n.type === "condition")) {
    const cnIndex = intermediateNodes.findIndex((n) => n.id === cn.id);

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


export function findConvergingConditionBranches(
  intermediateNodes: GraphNode[],
  rawEdges: GraphEdge[],
): InputMappingViolation[] {
  const violations: InputMappingViolation[] = [];

  for (const cn of intermediateNodes.filter((n) => n.type === "condition")) {
    const trueEdge = rawEdges.find((e) => e.source === cn.id && e.path === "true");
    const falseEdge = rawEdges.find((e) => e.source === cn.id && e.path === "false");
    if (!trueEdge || !falseEdge || trueEdge.target !== falseEdge.target) continue;

    violations.push({
      kind: "condition_branches_converge",
      nodeId: cn.id,
      nodeName: cn.name,
      field: "path",
      invalidValue: trueEdge.target,
      reason: `condition node "${cn.id}" ("${cn.name}")'s "true" and "false" branches both point directly to "${trueEdge.target}" — the condition has no actual effect. Route each branch to a different immediate next node (they can still reconverge later, e.g. both eventually reaching a shared save/report node — that's fine, just not as the very next step).`,
    });
  }

  return violations;
}

export function ensureAllNodesReachEnd(
  intermediateNodes: GraphNode[],
  rawEdges: GraphEdge[],
): GraphEdge[] {
  const canReachEnd = (startNodeId: string, visited = new Set<string>()): boolean => {
    if (startNodeId === "end") return true;
    if (visited.has(startNodeId)) return false;
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

export function sanitizeGraphEdges(
  intermediateNodes: GraphNode[],
  rawEdges: GraphEdge[],
): GraphEdge[] {
  let edges = rawEdges;
  edges = ensureStartHasOutgoingEdge(intermediateNodes, edges);
  edges = ensureNoOrphanNodes(intermediateNodes, edges);
  edges = ensureNoDeadEnds(intermediateNodes, edges);
  edges = pruneDuplicateConditionBranches(intermediateNodes, edges);
  edges = ensureAllNodesReachEnd(intermediateNodes, edges);
  edges = deduplicateEdges(edges);
  return edges;
}
