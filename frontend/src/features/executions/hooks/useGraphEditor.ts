import { useMemo, useState } from "react";
import type { Connection } from "@xyflow/react";
import { arrangeGraph, hasOverlaps } from "../visual-builder/graphMapper";
import type { LayoutDirection } from "../visual-builder/layoutDirection";
import { saveExecutionGraph } from "../api/saveExecutionGraph";
import {
  addNode,
  connectNodes,
  createNode,
  hasNodeOfType,
  reconnectEdge,
  removeEdges,
  removeNodes,
  updateNode,
} from "../lib/graphOps";
import type {
  GraphNode,
  GraphViolation,
  LangGraphAbstraction,
  PaletteNodeType,
} from "../types";
import type { KeyedUpdater } from "@/hooks/useKeyedState";

interface UseGraphEditorOptions {
  executionId: string | null;
  graph: LangGraphAbstraction | null;
  setGraph: (value: KeyedUpdater<LangGraphAbstraction | null>) => void;
  isEditing: boolean;
  setIsEditing: (value: boolean) => void;
  draftGraph: LangGraphAbstraction | null;
  setDraftGraph: (value: KeyedUpdater<LangGraphAbstraction | null>) => void;
}

export type SaveStatus = "idle" | "verifying" | "failed";

export function useGraphEditor({
  executionId,
  graph,
  setGraph,
  isEditing,
  setIsEditing,
  draftGraph,
  setDraftGraph,
}: UseGraphEditorOptions) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [violations, setViolations] = useState<GraphViolation[]>([]);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);

  const isDirty = useMemo(
    () => isEditing && JSON.stringify(draftGraph) !== JSON.stringify(graph),
    [isEditing, draftGraph, graph],
  );

  const errorNodeIds = useMemo(
    () => new Set(violations.map((v) => v.nodeId).filter(Boolean)),
    [violations],
  );
  const errorEdgeIds = useMemo(
    () => new Set(violations.map((v) => v.edgeId).filter(Boolean) as string[]),
    [violations],
  );

  const [previousLayout, setPreviousLayout] = useState<Map<string, GraphNode["uiPosition"]> | null>(null);
  const [arrangeVersion, setArrangeVersion] = useState(0);

  const clearViolations = () => {
    setViolations([]);
    setSaveErrors([]);
  };

  const mutate = (fn: (g: LangGraphAbstraction) => LangGraphAbstraction) => {
    if (violations.length > 0) clearViolations();
    setDraftGraph((prev) => (prev ? fn(prev) : prev));
  };

  const startEditing = () => {
    if (!graph) return;
    setDraftGraph(graph.nodes.length > 0 && hasOverlaps(graph) ? arrangeGraph(graph) : graph);
    clearViolations();
    setPreviousLayout(null);
    setIsEditing(true);
  };

  const discard = () => {
    setDraftGraph(graph);
    clearViolations();
    setPreviousLayout(null);
    setIsEditing(false);
  };

  const dropNode = (type: PaletteNodeType, position: { x: number; y: number }): string | null => {
    if (!draftGraph) return null;
    if ((type === "start" || type === "end") && hasNodeOfType(draftGraph, type)) return null;
    const node = createNode(type, draftGraph, position);
    mutate((g) => addNode(g, node));
    return node.id;
  };

  const connect = (c: Connection) =>
    mutate((g) => connectNodes(g, { source: c.source, target: c.target, sourceHandle: c.sourceHandle }));

  const reconnect = (edgeId: string, c: Connection) =>
    mutate((g) => reconnectEdge(g, edgeId, { source: c.source, target: c.target, sourceHandle: c.sourceHandle }));

  const moveNode = (id: string, position: { x: number; y: number }) =>
    mutate((g) => updateNode(g, id, { uiPosition: position }));

  const editNode = (id: string, patch: Partial<Pick<GraphNode, "name" | "config">>) =>
    mutate((g) => updateNode(g, id, patch));

  const deleteNodes = (ids: string[]) => mutate((g) => removeNodes(g, ids));
  const deleteEdges = (ids: string[]) => mutate((g) => removeEdges(g, ids));

  const arrange = (direction: LayoutDirection) => {
    if (!draftGraph || draftGraph.nodes.length === 0) return;
    // Keep the layout from before the first arrange, so Undo goes back to it even after several arranges.
    setPreviousLayout((prev) => prev ?? new Map(draftGraph.nodes.map((n) => [n.id, n.uiPosition])));
    setArrangeVersion((v) => v + 1);
    mutate((g) => arrangeGraph(g, direction));
  };

  const undoArrange = () => {
    if (!previousLayout) return;
    const saved = previousLayout;
    setPreviousLayout(null);
    setArrangeVersion((v) => v + 1);
    mutate((g) => ({
      ...g,
      nodes: g.nodes.map((n) => {
        if (!saved.has(n.id)) return n;
        const { uiPosition: _current, ...rest } = n;
        const uiPosition = saved.get(n.id);
        return uiPosition ? { ...rest, uiPosition } : rest;
      }),
    }));
  };

  const save = async (): Promise<boolean> => {
    if (!executionId || !draftGraph) return false;
    clearViolations();
    setSaveStatus("verifying");
    try {
      const result = await saveExecutionGraph(executionId, draftGraph);
      if (result.ok === false) {
        setViolations(result.violations);
        setSaveErrors(result.errors);
        setSaveStatus("failed");
        return false;
      }
      setGraph(result.graph);
      setDraftGraph(result.graph);
      setIsEditing(false);
      setPreviousLayout(null);
      setSaveStatus("idle");
      return true;
    } catch (error) {
      setSaveErrors([error instanceof Error ? error.message : "Could not save the graph"]);
      setSaveStatus("failed");
      return false;
    }
  };

  const closeSaveModal = () => setSaveStatus("idle");

  return {
    isDirty,
    saveStatus,
    violations,
    saveErrors,
    errorNodeIds,
    errorEdgeIds,
    startEditing,
    discard,
    dropNode,
    connect,
    reconnect,
    moveNode,
    editNode,
    deleteNodes,
    deleteEdges,
    arrange,
    undoArrange,
    canUndoArrange: previousLayout !== null,
    arrangeVersion,
    save,
    closeSaveModal,
  };
}
