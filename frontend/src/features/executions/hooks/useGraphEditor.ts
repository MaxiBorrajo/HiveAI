import { useMemo, useState } from "react";
import type { Connection } from "@xyflow/react";
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
    setDraftGraph(graph);
    clearViolations();
    setIsEditing(true);
  };

  const discard = () => {
    setDraftGraph(graph);
    clearViolations();
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

  /** Validates (server side) and persists the draft. Returns true when saved. */
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
    save,
    closeSaveModal,
  };
}
