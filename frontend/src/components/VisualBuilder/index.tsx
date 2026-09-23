import { useEffect, useMemo } from "react";
import Dagre from "@dagrejs/dagre";
import {
  useNodesState,
  useEdgesState,
  useReactFlow,
  Position,
  ReactFlow,
  Controls,
  Background,
} from "@xyflow/react";
import type { Node, Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { LangGraphAbstraction } from "../../types/execution";
import { GhostNode } from "./GhostNode";

interface VisualBuilderProps {
  graph?: LangGraphAbstraction | null;
  onSave?: (graph: LangGraphAbstraction) => void;
  activeNodeId?: string; // For streaming / running feedback
  isGenerating?: boolean; // For showing the Ghost / thinking node
  planningThought?: string | null; // For displaying current thought in ghost node
  selectedNodeId?: string | null;
  onNodeSelect?: (nodeId: string | null) => void;
}

const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
  if (nodes.length === 0) return { nodes: [], edges: [] };

  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR" });

  edges.forEach((edge) => g.setEdge(edge.source, edge.target));
  nodes.forEach((node) =>
    g.setNode(node.id, {
      ...node,
      // Default dimensions if not measured yet
      width: node.measured?.width ?? 180,
      height: node.measured?.height ?? 54,
    }),
  );

  Dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const position = g.node(node.id);
    const x = position.x - (node.measured?.width ?? 180) / 2;
    const y = position.y - (node.measured?.height ?? 54) / 2;

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
}: VisualBuilderProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Convert backend graph to React Flow graph
  const nodeTypes = useMemo(() => ({ ghost: GhostNode }), []);

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

      let borderColor = "#3f3f46";
      let boxShadow = "none";
      let bgColor = "#18181b";

      if (isActive) {
        borderColor = "#f59e0b";
        boxShadow = "0 0 12px rgba(245, 158, 11, 0.5)";
      } else if (isSelected) {
        borderColor = "#e4e4e7";
        boxShadow = "0 0 10px rgba(255, 255, 255, 0.25)";
        bgColor = "#27272a";
      }

      return {
        id: n.id,
        position: { x: 0, y: 0 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: {
          label: (
            <div className="flex flex-col text-left">
              <span className="font-medium text-xs text-zinc-100">
                {n.name}
              </span>
              <span className="text-[10px] text-zinc-400 capitalize">
                {n.type}
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
        },
      };
    });

    const rfEdges: Edge[] = currentEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.isConditional ? "Conditional" : "",
      animated: activeNodeId === e.source,
      style: {
        stroke: activeNodeId === e.source ? "#f59e0b" : "#71717a",
        strokeWidth: 2,
      },
    }));

    // If generating and not yet ended with 'end' node, show Ghost Node
    const hasEndNode = currentNodes.some((n) => n.type === "end");
    if (isGenerating && !hasEndNode) {
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
        rfEdges.push({
          id: `edge_${lastNode.id}_${ghostId}`,
          source: lastNode.id,
          target: ghostId,
          animated: true,
          style: { stroke: "#f59e0b", strokeWidth: 2, strokeDasharray: "5 5" },
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
        onPaneClick={() => onNodeSelect?.(null)}
        fitView
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
        fitView({ duration: 400, padding: 0.2 });
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [nodesCount, isGenerating, fitView]);

  return null;
}
