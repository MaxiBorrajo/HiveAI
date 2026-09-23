import { useEffect } from "react";
import Dagre from "@dagrejs/dagre";
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Position,
} from "@xyflow/react";
import type { Node, Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { LangGraphAbstraction } from "../../types/execution";

interface VisualBuilderProps {
  graph?: LangGraphAbstraction | null;
  onSave?: (graph: LangGraphAbstraction) => void;
  activeNodeId?: string; // For streaming feedback
}

const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR" });

  edges.forEach((edge) => g.setEdge(edge.source, edge.target));
  nodes.forEach((node) =>
    g.setNode(node.id, {
      ...node,
      // Default dimensions if not measured yet
      width: node.measured?.width ?? 150,
      height: node.measured?.height ?? 50,
    }),
  );

  Dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const position = g.node(node.id);
    const x = position.x - (node.measured?.width ?? 150) / 2;
    const y = position.y - (node.measured?.height ?? 50) / 2;

    return { ...node, position: { x, y } };
  });

  return { nodes: layoutedNodes, edges };
};

export function VisualBuilder({ graph, activeNodeId }: VisualBuilderProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Convert backend graph to React Flow graph
  useEffect(() => {
    if (!graph) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const rfNodes: Node[] = graph.nodes.map((n) => {
      return {
        id: n.id,
        position: { x: 0, y: 0 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: { label: `${n.name} (${n.type})` },
        style: {
          background: activeNodeId === n.id ? "#ffc107" : "#fff",
          border: "1px solid #222",
          padding: 10,
          borderRadius: 5,
          fontWeight: activeNodeId === n.id ? "bold" : "normal",
          color: "#000",
          width: 150,
        },
      };
    });

    const rfEdges: Edge[] = graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.isConditional ? "Conditional" : "",
      animated: activeNodeId === e.source,
    }));

    const layouted = getLayoutedElements(rfNodes, rfEdges);

    setNodes(layouted.nodes);
    setEdges(layouted.edges);
  }, [graph, activeNodeId, setNodes, setEdges]);

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
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        colorMode="dark"
        style={{ backgroundColor: "transparent" }}
      >
        <Controls position="bottom-left" />
        <Background gap={40} size={1} bgColor="#050403"/>
      </ReactFlow>
    </div>
  );
}
