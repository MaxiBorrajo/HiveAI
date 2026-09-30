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
import { StandardNode } from "./StandardNode";

interface VisualBuilderProps {
  graph?: LangGraphAbstraction | null;
  onSave?: (graph: LangGraphAbstraction) => void;
  activeNodeId?: string; // For streaming / running feedback
  activeToolName?: string | null; // For displaying currently executing tool
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
    const isCondition = node.type === "condition";
    const plugins = Array.isArray((node.data as any)?.config?.plugins)
      ? (node.data as any).config.plugins
      : [];
    const hasTools = plugins.length > 0;
    const defaultWidth = 260;
    const defaultHeight = isCondition ? 136 : (hasTools ? 135 : 76);

    g.setNode(node.id, {
      ...node,
      width: node.measured?.width ?? defaultWidth,
      height: isCondition ? 136 : (node.measured?.height ?? defaultHeight),
    });
  });

  Dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const position = g.node(node.id);
    const isCondition = node.type === "condition";
    const plugins = Array.isArray((node.data as any)?.config?.plugins)
      ? (node.data as any).config.plugins
      : [];
    const hasTools = plugins.length > 0;
    const defaultWidth = 260;
    const defaultHeight = isCondition ? 136 : (hasTools ? 135 : 76);

    const width = node.measured?.width ?? defaultWidth;
    const height = node.measured?.height ?? defaultHeight;
    const x = position ? position.x - width / 2 : 0;
    const y = position ? position.y - height / 2 : 0;

    return { ...node, position: { x, y } };
  });

  return { nodes: layoutedNodes, edges };
};

export function VisualBuilder({
  graph,
  activeNodeId,
  activeToolName,
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
    () => ({
      ghost: GhostNode,
      condition: ConditionNode,
      standard: StandardNode,
    }),
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
      const isUpdating = (activeNodeId === n.id && isGenerating) || (isGenerating && isSelected);
      const isExecuting = activeNodeId === n.id && !isGenerating;

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
            isExecuting,
            isSelected,
          },
          style: {
            zIndex: isSelected || isUpdating || isExecuting ? 10 : 1,
          },
        };
      }

      return {
        id: n.id,
        type: "standard",
        position: { x: 0, y: 0 },
        data: {
          name: n.name,
          type: n.type,
          config: n.config,
          isActive,
          isUpdating,
          isExecuting,
          isSelected,
          activeTool: activeToolName,
        },
        style: {
          zIndex: isSelected || isUpdating || isExecuting ? 10 : 1,
        },
      };
    });

    const rfEdges: Edge[] = currentEdges.map((e) => {
      const isAnimated = activeNodeId === e.source || selectedEdgeId === e.id;
      const strokeColor = "var(--primary)";

      const sourceNode = currentNodes.find((n) => n.id === e.source);
      const isFromCondition = sourceNode?.type === "condition";
      const isFalseBranch = isFromCondition && e.path === "false";
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
        pathOptions: isFalseBranch
          ? { offset: 50, borderRadius: 16 }
          : { offset: 25, borderRadius: 12 },
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
