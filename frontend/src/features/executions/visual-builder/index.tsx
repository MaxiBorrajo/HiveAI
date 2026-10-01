import { useEffect, useMemo, useRef } from "react";
import {
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlow,
  Controls,
  Background,
} from "@xyflow/react";
import type { Node, Edge, Connection, ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { LangGraphAbstraction, PaletteNodeType } from "../types";
import { isConnectionAllowed } from "../lib/graphOps";
import { GhostNode } from "./GhostNode";
import { ConditionNode } from "./ConditionNode";
import { StandardNode } from "./StandardNode";
import { GHOST_NODE_ID, buildFlowElements } from "./graphMapper";

export const NODE_DRAG_MIME = "application/x-hiveai-node";

interface VisualBuilderProps {
  graph?: LangGraphAbstraction | null;
  activeNodeId?: string;
  activeToolName?: string | null;
  isGenerating?: boolean;
  planningThought?: string | null;
  selectedNodeId?: string | null;
  onNodeSelect?: (nodeId: string | null) => void;
  selectedEdgeId?: string | null;
  onEdgeSelect?: (edgeId: string | null) => void;
  editable?: boolean;
  errorNodeIds?: ReadonlySet<string>;
  errorEdgeIds?: ReadonlySet<string>;
  onConnectNodes?: (connection: Connection) => void;
  onReconnectEdge?: (edgeId: string, connection: Connection) => void;
  onDropNode?: (type: PaletteNodeType, position: { x: number; y: number }) => void;
  onMoveNode?: (nodeId: string, position: { x: number; y: number }) => void;
  onDeleteNodes?: (nodeIds: string[]) => void;
  onDeleteEdges?: (edgeIds: string[]) => void;
}

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
  editable,
  errorNodeIds,
  errorEdgeIds,
  onConnectNodes,
  onReconnectEdge,
  onDropNode,
  onMoveNode,
  onDeleteNodes,
  onDeleteEdges,
}: VisualBuilderProps) {
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

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
    const layouted = buildFlowElements(graph, {
      activeNodeId,
      activeToolName,
      isGenerating,
      planningThought,
      selectedNodeId,
      selectedEdgeId,
      editable,
      errorNodeIds,
      errorEdgeIds,
    });

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
    editable,
    errorNodeIds,
    errorEdgeIds,
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
        onInit={(instance) => {
          rfRef.current = instance;
        }}
        nodesDraggable={!!editable}
        nodesConnectable={!!editable}
        deleteKeyCode={editable ? ["Backspace", "Delete"] : null}
        isValidConnection={(c) =>
          !!graph && isConnectionAllowed(graph, {
            source: c.source,
            target: c.target,
            sourceHandle: c.sourceHandle,
          })
        }
        onConnect={(c) => onConnectNodes?.(c)}
        edgesReconnectable={!!editable}
        onReconnect={(oldEdge, c) => onReconnectEdge?.(oldEdge.id, c)}
        onNodeDragStop={(_, node) => onMoveNode?.(node.id, node.position)}
        onNodesDelete={(deleted) => onDeleteNodes?.(deleted.map((n) => n.id))}
        onEdgesDelete={(deleted) => onDeleteEdges?.(deleted.map((e) => e.id))}
        onDragOver={(event) => {
          if (!editable) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          if (!editable) return;
          const type = event.dataTransfer.getData(NODE_DRAG_MIME) as PaletteNodeType;
          if (!type || !rfRef.current) return;
          event.preventDefault();
          const position = rfRef.current.screenToFlowPosition({
            x: event.clientX,
            y: event.clientY,
          });
          onDropNode?.(type, { x: position.x - 130, y: position.y - 38 });
        }}
        onNodeClick={(_, node) => {
          if (node.id !== GHOST_NODE_ID) {
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
          disabled={!!editable}
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
  disabled,
}: {
  nodesCount: number;
  isGenerating?: boolean;
  disabled?: boolean;
}) {
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (nodesCount > 0 && !disabled) {
      const timer = setTimeout(() => {
        fitView({ duration: 400, padding: 0.2, maxZoom: 1 });
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [nodesCount, isGenerating, disabled, fitView]);

  return null;
}
