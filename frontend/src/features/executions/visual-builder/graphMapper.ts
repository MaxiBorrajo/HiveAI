import Dagre from "@dagrejs/dagre";
import { MarkerType, Position } from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import type { GraphEdge, GraphNode } from "../types";

export const GHOST_NODE_ID = "__ghost_node__";

const EDGE_COLORS = {
  selected: "#3b82f6",
  trueBranch: "#22c55e",
  falseBranch: "#ef4444",
};

const NODE_WIDTH = 260;
const CONDITION_HEIGHT = 136;
const TOOL_NODE_HEIGHT = 135;
const PLAIN_NODE_HEIGHT = 76;

function getNodeSize(node: Node) {
  const isCondition = node.type === "condition";
  const plugins = (node.data as { config?: { plugins?: unknown } })?.config?.plugins;
  const hasTools = Array.isArray(plugins) && plugins.length > 0;
  const defaultHeight = isCondition
    ? CONDITION_HEIGHT
    : hasTools
      ? TOOL_NODE_HEIGHT
      : PLAIN_NODE_HEIGHT;

  return {
    width: node.measured?.width ?? NODE_WIDTH,
    height: isCondition ? CONDITION_HEIGHT : (node.measured?.height ?? defaultHeight),
    measuredHeight: node.measured?.height ?? defaultHeight,
  };
}

export function getLayoutedElements(nodes: Node[], edges: Edge[]) {
  if (nodes.length === 0) return { nodes: [], edges: [] };

  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "LR",
    align: "UL",
    nodesep: 90,
    ranksep: 120,
    edgesep: 40,
    marginx: 40,
    marginy: 40,
  });

  edges.forEach((edge) => g.setEdge(edge.source, edge.target));
  nodes.forEach((node) => {
    const { width, height } = getNodeSize(node);
    g.setNode(node.id, { ...node, width, height });
  });

  Dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    if ((node.data as { manualPosition?: boolean })?.manualPosition) return node;
    const position = g.node(node.id);
    const { width, measuredHeight } = getNodeSize(node);
    return {
      ...node,
      position: {
        x: position ? position.x - width / 2 : 0,
        y: position ? position.y - measuredHeight / 2 : 0,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

export interface GraphViewState {
  activeNodeId?: string;
  activeToolName?: string | null;
  isGenerating?: boolean;
  planningThought?: string | null;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  editable?: boolean;
  errorNodeIds?: ReadonlySet<string>;
  errorEdgeIds?: ReadonlySet<string>;
}

function toReactFlowNode(n: GraphNode, view: GraphViewState): Node {
  const { activeNodeId, activeToolName, isGenerating, selectedNodeId } = view;
  const isSelected = selectedNodeId === n.id;
  const isActive = activeNodeId === n.id;
  const isUpdating = (isActive && isGenerating) || (isGenerating && isSelected);
  const isExecuting = isActive && !isGenerating;
  const hasError = view.errorNodeIds?.has(n.id) ?? false;
  const state = {
    isActive,
    isUpdating,
    isExecuting,
    isSelected,
    hasError,
    manualPosition: !!n.uiPosition,
  };
  const style = { zIndex: isSelected || isUpdating || isExecuting ? 10 : 1 };

  if (n.type === "condition") {
    return {
      id: n.id,
      type: "condition",
      selected: isSelected,
      position: n.uiPosition ?? { x: 0, y: 0 },
      data: { name: n.name, config: n.config, ...state },
      style,
    };
  }

  return {
    id: n.id,
    type: "standard",
    selected: isSelected,
    position: n.uiPosition ?? { x: 0, y: 0 },
    data: {
      name: n.name,
      type: n.type,
      config: n.config,
      ...state,
      activeTool: activeToolName,
    },
    style,
  };
}

function toReactFlowEdge(
  e: GraphEdge,
  nodes: GraphNode[],
  view: GraphViewState,
): Edge & { pathOptions?: { offset: number; borderRadius: number } } {
  const { activeNodeId, selectedEdgeId } = view;
  const isSelected = selectedEdgeId === e.id;
  const isAnimated = activeNodeId === e.source || isSelected;

  const isFromCondition =
    nodes.find((n) => n.id === e.source)?.type === "condition";
  const isFalseBranch = isFromCondition && e.path === "false";
  const isActive = activeNodeId === e.source || activeNodeId === e.target;
  const hasError = view.errorEdgeIds?.has(e.id) ?? false;
  const edgeColor = hasError
    ? EDGE_COLORS.falseBranch
    : isSelected
    ? EDGE_COLORS.selected
    : isFromCondition && e.path === "true"
      ? EDGE_COLORS.trueBranch
      : isFalseBranch
        ? EDGE_COLORS.falseBranch
        : isActive
          ? "var(--primary)"
          : "var(--border)";

  return {
    id: e.id,
    selected: isSelected,
    source: e.source,
    target: e.target,
    sourceHandle: isFromCondition ? (e.path === "false" ? "false" : "true") : undefined,
    type: "smoothstep",
    pathOptions: isFalseBranch
      ? { offset: 50, borderRadius: 16 }
      : { offset: 25, borderRadius: 12 },
    label: isFromCondition && e.path ? (e.path === "true" ? "True" : "False") : "",
    animated: isAnimated,
    style: { stroke: edgeColor, strokeWidth: isActive || isSelected ? 3 : 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor },
  };
}

export function buildFlowElements(
  graph: { nodes: GraphNode[]; edges: GraphEdge[] } | null | undefined,
  view: GraphViewState,
) {
  const currentNodes = graph?.nodes || [];
  const currentEdges = graph?.edges || [];

  const rfNodes = currentNodes.map((n) => toReactFlowNode(n, view));
  const rfEdges = currentEdges.map((e) => toReactFlowEdge(e, currentNodes, view));

  const hasEndNode = currentNodes.some((n) => n.type === "end");
  if (view.isGenerating && (!hasEndNode || view.editable) && !view.selectedNodeId) {
    rfNodes.push({
      id: GHOST_NODE_ID,
      type: "ghost",
      position: { x: 0, y: 0 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: { label: view.planningThought || undefined },
    });

    const lastNode = [...currentNodes].reverse().find((n) => n.type !== "end");
    if (lastNode) {
      rfEdges.push({
        id: `edge_${lastNode.id}_${GHOST_NODE_ID}`,
        source: lastNode.id,
        target: GHOST_NODE_ID,
        sourceHandle: lastNode.type === "condition" ? "true" : undefined,
        type: "smoothstep",
        animated: true,
        style: { stroke: "var(--primary)", strokeWidth: 1.5 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 12,
          height: 12,
          color: "var(--primary)",
        },
      });
    }
  }

  return getLayoutedElements(rfNodes, rfEdges);
}
