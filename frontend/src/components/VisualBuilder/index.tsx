import { useEffect } from "react";
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import type { Node, Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { LangGraphAbstraction } from "../../types/execution";

interface VisualBuilderProps {
  graph: LangGraphAbstraction;
  onSave?: (graph: LangGraphAbstraction) => void;
  activeNodeId?: string; // For streaming feedback
}

export function VisualBuilder({ graph, activeNodeId }: VisualBuilderProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Convert backend graph to React Flow graph
  useEffect(() => {
    if (!graph) return;

    let currentY = 50;
    const rfNodes: Node[] = graph.nodes.map((n) => {
      // Very basic auto-layout if no uiPosition
      const x = n.uiPosition?.x ?? 250;
      const y = n.uiPosition?.y ?? (currentY += 100);

      return {
        id: n.id,
        position: { x, y },
        data: { label: `${n.name} (${n.type})` },
        style: {
          background: activeNodeId === n.id ? "#ffc107" : "#fff",
          border: "1px solid #222",
          padding: 10,
          borderRadius: 5,
          fontWeight: activeNodeId === n.id ? "bold" : "normal",
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

    setNodes(rfNodes);
    setEdges(rfEdges);
  }, [graph, activeNodeId, setNodes, setEdges]);

  return (
    <div style={{ width: "100%", height: "500px", border: "1px solid #ccc" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
      >
        <Controls />
        <MiniMap />
        <Background gap={12} size={1} />
      </ReactFlow>
    </div>
  );
}
