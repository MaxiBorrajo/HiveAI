import { useEffect, useMemo } from "react";
import Dagre from "@dagrejs/dagre";
import {
  useNodesState,
  useEdgesState,
  useReactFlow,
  MarkerType,
  Position,
  ReactFlow,
  Controls,
  Background,
} from "@xyflow/react";
import type { Node, Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { LangGraphAbstraction } from "../../types/execution";
import { GhostNode } from "./GhostNode";
import { ConditionNode } from "./ConditionNode";

interface VisualBuilderProps {
  graph?: LangGraphAbstraction | null;
  onSave?: (graph: LangGraphAbstraction) => void;
  activeNodeId?: string; // For streaming / running feedback
  isGenerating?: boolean; // For showing the Ghost / thinking node
  planningThought?: string | null; // For displaying current thought in ghost node
  selectedNodeId?: string | null;
  onNodeSelect?: (nodeId: string | null) => void;
  selectedEdgeId?: string | null;
  onEdgeSelect?: (edgeId: string | null) => void;
}

const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
  if (nodes.length === 0) return { nodes: [], edges: [] };

  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR" });

  edges.forEach((edge) => g.setEdge(edge.source, edge.target));
  nodes.forEach((node) => {
    const isCondition = node.type === "condition";
    g.setNode(node.id, {
      ...node,
      // Condition nodes are square 110x110; regular nodes are 180x54
      width: isCondition ? 110 : (node.measured?.width ?? 180),
      height: isCondition ? 110 : (node.measured?.height ?? 54),
    });
  });

  Dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const position = g.node(node.id);
    const width = node.measured?.width ?? 180;
    const height = node.measured?.height ?? 54;
    const x = position ? position.x - width / 2 : 0;
    const y = position ? position.y - height / 2 : 0;

    return { ...node, position: { x, y } };
  });

  return { nodes: layoutedNodes, edges };
};

export function VisualBuilder({
  graph,
  activeNodeId,
  isGenerating,
  planningThought,
  selectedNodeId,
  onNodeSelect,
  selectedEdgeId,
  onEdgeSelect,
}: VisualBuilderProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Convert backend graph to React Flow graph
  const nodeTypes = useMemo(
    () => ({ ghost: GhostNode, condition: ConditionNode }),
    [],
  );

  useEffect(() => {
    if (!graph && !isGenerating) {
      setNodes([]);
      setEdges([]);
      return;
    }
    const currentNodes = graph?.nodes || [];
    const currentEdges = graph?.edges || [];

    // Map backend nodes to ReactFlow nodes
    const rfNodes: Node[] = currentNodes.map((n) => {
      const isSelected = selectedNodeId === n.id;
      const isActive = activeNodeId === n.id;
      const isUpdating = isGenerating && isSelected;

      if (n.type === "condition") {
        return {
          id: n.id,
          type: "condition",
          position: { x: 0, y: 0 },
          data: {
            name: n.name,
            config: n.config,
            isActive,
            isUpdating,
            isSelected,
          },
          style: {
            width: 110,
            height: 110,
            zIndex: isSelected || isUpdating ? 10 : 1,
          },
        };
      }

      let borderColor = "var(--border, #3f3f46)";
      let boxShadow = "none";
      // Lighter background for better contrast against #050403
      let bgColor = "var(--muted, #27272a)";

      if (isActive || isUpdating) {
        borderColor = "var(--primary)";
        boxShadow = "0 0 14px var(--primary)";
        bgColor = "var(--secondary, #3f3f46)";
      } else if (isSelected) {
        borderColor = "var(--primary)";
        boxShadow = "0 0 10px var(--primary)";
        bgColor = "var(--secondary, #3f3f46)";
      }

      return {
        id: n.id,
        position: { x: 0, y: 0 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: {
          label: (
            <div className="flex flex-col text-left">
              <div className="flex items-center gap-1.5">
                {isUpdating && (
                  <span className="size-2 rounded-full bg-primary animate-ping shrink-0" />
                )}
                <span className="font-medium text-xs text-zinc-100">
                  {n.name}
                </span>
              </div>
              <span className="text-[10px] text-zinc-400 capitalize">
                {isUpdating ? "Updating..." : n.type}
              </span>
            </div>
          ),
        },
        style: {
          background: bgColor,
          border: `1.5px solid ${borderColor}`,
          padding: "8px 12px",
          borderRadius: 8,
          color: "#fafafa",
          width: 170,
          cursor: "pointer",
          boxShadow,
          transition: "all 0.2s ease-in-out",
          zIndex: isSelected || isUpdating ? 10 : 1,
        },
      };
    });

    const rfEdges: Edge[] = currentEdges.map((e) => {
      const isAnimated = activeNodeId === e.source || selectedEdgeId === e.id;
      const strokeColor = "var(--primary)";

      const sourceNode = currentNodes.find((n) => n.id === e.source);
      const isFromCondition = sourceNode?.type === "condition";
      const isActive = activeNodeId === e.source || activeNodeId === e.target;
      const edgeColor =
        selectedEdgeId === e.id
          ? "#3b82f6"
          : isFromCondition && e.path === "true"
            ? "#22c55e"
            : isFromCondition && e.path === "false"
              ? "#ef4444"
              : isActive
                ? strokeColor
                : "var(--border)";

      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: isFromCondition
          ? e.path === "false"
            ? "false"
            : "true"
          : undefined,
        type: "smoothstep",
        label:
          isFromCondition && e.path
            ? e.path === "true"
              ? "True"
              : "False"
            : "",
        animated: isAnimated,
        style: {
          stroke: edgeColor,
          strokeWidth: isActive || selectedEdgeId === e.id ? 3 : 1.5,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: edgeColor,
        },
      };
    });

    // If generating and not yet ended with 'end' node, show Ghost Node (unless updating an existing node)
    const hasEndNode = currentNodes.some((n) => n.type === "end");
    if (isGenerating && !hasEndNode && !selectedNodeId) {
      const ghostId = "__ghost_node__";
      rfNodes.push({
        id: ghostId,
        type: "ghost",
        position: { x: 0, y: 0 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: {
          label: planningThought || undefined,
        },
      });

      if (currentNodes.length > 0) {
        const lastNode = currentNodes[currentNodes.length - 1];
        const isLastCondition = lastNode.type === "condition";
        rfEdges.push({
          id: `edge_${lastNode.id}_${ghostId}`,
          source: lastNode.id,
          target: ghostId,
          sourceHandle: isLastCondition ? "true" : undefined,
          type: "smoothstep",
          animated: true,
          style: {
            stroke: "var(--primary)",
            strokeWidth: 1.5,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 12,
            height: 12,
            color: "var(--primary)",
          },
        });
      }
    }

    const layouted = getLayoutedElements(rfNodes, rfEdges);

    setNodes(layouted.nodes);
    setEdges(layouted.edges);
  }, [
    graph,
    activeNodeId,
    isGenerating,
    planningThought,
    selectedNodeId,
    setNodes,
    setEdges,
    selectedEdgeId,
  ]);

  return (
    <div
      className="bg-background"
      style={{
        width: "100%",
        height: "100%",
        border: "none",
        display: "flex",
        flex: 1,
        minHeight: 0,
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => {
          if (node.id !== "__ghost_node__") {
            onNodeSelect?.(node.id === selectedNodeId ? null : node.id);
          }
        }}
        onEdgeClick={(_, edge) => {
          onEdgeSelect?.(edge.id === selectedEdgeId ? null : edge.id);
        }}
        onPaneClick={() => {
          onNodeSelect?.(null);
          onEdgeSelect?.(null);
        }}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
        colorMode="dark"
        style={{ backgroundColor: "transparent" }}
      >
        <AutoFitOnUpdate
          nodesCount={nodes.length}
          isGenerating={isGenerating}
        />
        <Controls position="bottom-left" />
        <Background gap={40} size={1} bgColor="#050403" />
      </ReactFlow>
    </div>
  );
}

function AutoFitOnUpdate({
  nodesCount,
  isGenerating,
}: {
  nodesCount: number;
  isGenerating?: boolean;
}) {
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (nodesCount > 0) {
      const timer = setTimeout(() => {
        fitView({ duration: 400, padding: 0.2, maxZoom: 1 });
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [nodesCount, isGenerating, fitView]);

  return null;
}
