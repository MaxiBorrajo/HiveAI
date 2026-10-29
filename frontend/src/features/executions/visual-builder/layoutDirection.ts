import { Position } from "@xyflow/react";
import type { LangGraphAbstraction } from "../types";

export type LayoutDirection = "LR" | "RL" | "TB" | "BT";

export const DEFAULT_DIRECTION: LayoutDirection = "LR";

export const isVertical = (direction: LayoutDirection) => direction === "TB" || direction === "BT";

/** Side of a node where edges enter (target) and leave (source) for each flow direction. */
export function handlePositions(direction: LayoutDirection = DEFAULT_DIRECTION) {
  switch (direction) {
    case "RL":
      return { target: Position.Right, source: Position.Left };
    case "TB":
      return { target: Position.Top, source: Position.Bottom };
    case "BT":
      return { target: Position.Bottom, source: Position.Top };
    default:
      return { target: Position.Left, source: Position.Right };
  }
}

/**
 * The direction is not stored: it is read back from where the saved positions
 * put the edge targets relative to their sources.
 */
export function inferDirection(
  graph: Pick<LangGraphAbstraction, "nodes" | "edges"> | null | undefined,
): LayoutDirection {
  if (!graph) return DEFAULT_DIRECTION;
  const positions = new Map(graph.nodes.map((n) => [n.id, n.uiPosition]));
  let dx = 0;
  let dy = 0;
  for (const edge of graph.edges) {
    const from = positions.get(edge.source);
    const to = positions.get(edge.target);
    if (!from || !to) continue;
    dx += to.x - from.x;
    dy += to.y - from.y;
  }
  if (dx === 0 && dy === 0) return DEFAULT_DIRECTION;
  if (Math.abs(dy) > Math.abs(dx)) return dy >= 0 ? "TB" : "BT";
  return dx >= 0 ? "LR" : "RL";
}
