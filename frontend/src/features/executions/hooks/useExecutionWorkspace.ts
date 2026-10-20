import { useEffect, useRef } from "react";
import { useKeyedState } from "@/hooks/useKeyedState";
import { getExecution } from "@/features/executions/api/getExecution";
import { generateExecutionStream } from "@/features/executions/api/generateExecution";
import { runExecutionStream } from "@/features/executions/api/runExecutionStream";
import {
  finishConfiguring,
  newActivityEntry,
  type ActivityEntry,
} from "@/features/executions/lib/generationActivity";
import type { LangGraphAbstraction, ExecutionResultData } from "@/features/executions/types";

export interface ExecutionWorkspaceOptions {
  key: string;
  activeExecutionId: string | null;
  newExecutionToken: string;
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null, targetKey?: string) => void;
  onExecutionCreated: (id: string) => void;
}

export function useExecutionWorkspace({
  key,
  activeExecutionId,
  newExecutionToken,
  selectedNodeId,
  setSelectedNodeId,
  onExecutionCreated,
}: ExecutionWorkspaceOptions) {
  const justCreatedIdRef = useRef<string | null>(null);

  const isThinking = useKeyedState(key, false);
  const isRunning = useKeyedState(key, false);
  const graph = useKeyedState<LangGraphAbstraction | null>(key, null);
  const isEditing = useKeyedState(key, false);
  const draftGraph = useKeyedState<LangGraphAbstraction | null>(key, null);
  const activeNodeId = useKeyedState<string | undefined>(key, undefined);
  const planningThought = useKeyedState<string | null>(key, null);
  const logs = useKeyedState<string[]>(key, []);
  const activity = useKeyedState<ActivityEntry[]>(key, []);
  const executionResult = useKeyedState<ExecutionResultData | null>(key, null);
  const activeToolName = useKeyedState<string | null>(key, null);

  const moveAllKeys = (from: string, to: string) =>
    [
      isThinking,
      isRunning,
      graph,
      isEditing,
      draftGraph,
      activeNodeId,
      planningThought,
      logs,
      activity,
      executionResult,
      activeToolName,
    ].forEach((state) => state.moveKey(from, to));

  useEffect(() => {
    if (!activeExecutionId) return;

    if (justCreatedIdRef.current === activeExecutionId) {
      justCreatedIdRef.current = null;
      return;
    }

    if (graph.has(activeExecutionId)) return;

    getExecution(activeExecutionId)
      .then(({ data }) => {
        graph.set(data?.graph?.graph ?? null, activeExecutionId);
        if (data?.lastResult) {
          executionResult.set(data.lastResult, activeExecutionId);
        }
        logs.set([], activeExecutionId);
        setSelectedNodeId(null, activeExecutionId);
      })
      .catch((e) => console.error("Failed to load execution graph", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeExecutionId, key]);

  const generateAbortRef = useRef<AbortController | null>(null);

  const runAbortRef = useRef<AbortController | null>(null);

  const handleStop = () => generateAbortRef.current?.abort();
  const handleStopRun = () => runAbortRef.current?.abort();

  const handleGenerate = async (userPrompt: string) => {
    const controller = new AbortController();
    generateAbortRef.current = controller;
    let currentKey = key;
    const editing = isEditing.value && !!draftGraph.value;
    const graphState = editing ? draftGraph : graph;
    isThinking.set(true, currentKey);
    planningThought.set(null, currentKey);
    logs.set(["Pollinating flow: starting design..."], currentKey);
    activity.set([], currentKey);
    const note = (entry: Parameters<typeof newActivityEntry>[0]) =>
      activity.set((prev) => [...prev, newActivityEntry(entry)], currentKey);

    if (!editing && !activeExecutionId && !selectedNodeId) {
      graph.set(null, currentKey);
    }

    try {
      await generateExecutionStream(
        {
          content: userPrompt,
          executionId: activeExecutionId ? Number(activeExecutionId) : undefined,
          targetNodeId: editing ? (selectedNodeId ?? undefined) : undefined,
          ...(editing ? { currentGraph: draftGraph.value!, dryRun: true } : {}),
        },
        {
          onExecutionCreated: (id) => {
            const newId = String(id);
            justCreatedIdRef.current = newId;

            moveAllKeys(currentKey, newId);

            currentKey = newId;
            onExecutionCreated(newId);
          },
          onPlanning: (thoughts) => {
            planningThought.set(thoughts, currentKey);
            logs.set((prev) => [...prev, ` ${thoughts}`], currentKey);
            note({ kind: "planning", text: thoughts });
          },
          onNodeAdded: ({ node, edge, stateProperties }) => {
            planningThought.set(null, currentKey);
            graphState.set((prev) => {
              const current = prev || { nodes: [], edges: [], stateSchema: {} };
              if (current.nodes.some((n) => n.id === node.id)) {
                return current;
              }
              return {
                nodes: [...current.nodes, node],
                edges: edge ? [...current.edges, edge] : current.edges,
                stateSchema: { ...current.stateSchema, ...(stateProperties || {}) },
              };
            }, currentKey);
            logs.set((prev) => [...prev, `+ Built node: ${node.name} (${node.type})`], currentKey);
            note({
              kind: "built",
              text: `Built ${node.name} (${node.type})`,
              nodeId: node.id,
            });
          },
          onNodeConfiguring: ({ nodeId, nodeName }) => {
            activeNodeId.set(nodeId, currentKey);
            note({
              kind: "configuring",
              text: `Configuring ${nodeName}`,
              nodeId,
            });
            logs.set((prev) => [...prev, `⚙️ Configuring node: ${nodeName}...`], currentKey);
          },
          onNodeUpdated: ({ node, stateProperties }) => {
            planningThought.set(null, currentKey);
            activeNodeId.set(undefined, currentKey);
            graphState.set((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                nodes: prev.nodes.map((n) => (n.id === node.id ? node : n)),
                stateSchema: { ...prev.stateSchema, ...(stateProperties || {}) },
              };
            }, currentKey);
            logs.set((prev) => [...prev, `✨ Configured: ${node.name}`], currentKey);
            activity.set(
              (prev) => finishConfiguring(prev, node.id, node.name),
              currentKey,
            );
            setSelectedNodeId(null, activeExecutionId || newExecutionToken);
          },
          onNodeDeleted: ({ nodeId }) => {
            graphState.set((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                nodes: prev.nodes.filter((n) => n.id !== nodeId),
                edges: prev.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
              };
            }, currentKey);
            logs.set((prev) => [...prev, `- Removed node: ${nodeId}`], currentKey);
            note({ kind: "removed", text: `Removed ${nodeId}`, nodeId });
          },
          onEdgeAdded: ({ edge }) => {
            graphState.set((prev) => {
              if (!prev || prev.edges.some((e) => e.id === edge.id)) return prev;
              return { ...prev, edges: [...prev.edges, edge] };
            }, currentKey);
          },
          onWaitingForUser: ({ kind, question }) => {
            note({
              kind: "waiting",
              text:
                kind === "plan_review"
                  ? "Waiting for you to review the plan"
                  : `Waiting for your answer: ${question}`,
            });
          },
          onUserAnswered: ({ kind, question, answer }) => {
            const text =
              kind === "plan_review"
                ? `Plan review → ${answer}`
                : `${question} → ${answer}`;
            activity.set((prev) => {
              const index = prev.findLastIndex((e) => e.kind === "waiting");
              if (index === -1) {
                return [...prev, newActivityEntry({ kind: "answered", text })];
              }
              return prev.map((entry, i) =>
                i === index ? { ...entry, kind: "answered" as const, text } : entry,
              );
            }, currentKey);
          },
          onValidationError: ({ attempt, violations }) => {
            note({
              kind: "correction",
              text: `Fixing ${violations.length} issue${violations.length === 1 ? "" : "s"} (attempt ${attempt})`,
            });
          },
          onDone: (data) => {
            activeNodeId.set(undefined, currentKey);
            planningThought.set(null, currentKey);
            graphState.set(data.graph, currentKey);
            note({ kind: "done", text: "Workflow ready" });
            logs.set((prev) => [...prev, "✨ Flow assembled successfully!"], currentKey);
            isThinking.set(false, currentKey);
          },
          onError: (message) => {
            planningThought.set(null, currentKey);
            logs.set((prev) => [...prev, `❌ Error: ${message}`], currentKey);
            note({ kind: "error", text: message });
            isThinking.set(false, currentKey);
          },
        },
        controller.signal,
      );
    } catch (e: any) {
      planningThought.set(null, currentKey);
      if (controller.signal.aborted) {
        logs.set((prev) => [...prev, "⏹ Generation stopped."], currentKey);
      } else {
        logs.set((prev) => [...prev, `❌ Streaming error: ${e.message}`], currentKey);
      }
    } finally {
      if (generateAbortRef.current === controller) generateAbortRef.current = null;
      isThinking.set(false, currentKey);
      planningThought.set(null, currentKey);
    }
  };

  const handleRun = async (
    inputs: Record<string, any>,
    onResult: (result: ExecutionResultData) => void,
  ) => {
    if (!activeExecutionId) return;
    const currentKey = activeExecutionId;
    const controller = new AbortController();
    runAbortRef.current = controller;
    isRunning.set(true, currentKey);
    logs.set((prev) => [...prev, "--- Starting Execution ---"], currentKey);
    const finalInputs = { ...inputs };
    Object.keys(finalInputs).forEach((k) => {
      if (finalInputs[k] === "") delete finalInputs[k];
    });

    try {
      await runExecutionStream(activeExecutionId, finalInputs, {
        onDone: (data) => {
          const resultData: ExecutionResultData = {
            iteration: data.iteration,
            historyId: data.historyId,
            result: data.result,
            finalState: data.finalState,
            createdAt: Date.now(),
          };
          executionResult.set(resultData, currentKey);
          onResult(resultData);
          logs.set(
            (prev) => [...prev, `✅ Execution completed (iteration #${data.iteration || 1})`],
            currentKey,
          );
        },
        onWarning: (messages) => {
          logs.set(
            (prev) => [...prev, ...messages.map((m) => `⚠️ ${m}`)],
            currentKey,
          );
        },
        onError: (message) => {
          logs.set((prev) => [...prev, `❌ Execution error: ${message}`], currentKey);
        },
        onNodeStart: (nodeName) => {
          activeNodeId.set(nodeName, currentKey);
          activeToolName.set(null, currentKey);
          logs.set((prev) => [...prev, `⚡ [start] Node: ${nodeName}`], currentKey);
        },
        onToolStart: (toolName) => {
          activeToolName.set(toolName, currentKey);
          logs.set((prev) => [...prev, `🔧 [tool] ${toolName}`], currentKey);
        },
        onToolEnd: (toolName) => {
          activeToolName.set(null, currentKey);
          logs.set((prev) => [...prev, `✓ [tool done] ${toolName || ""}`], currentKey);
        },
      }, controller.signal);
    } catch (e: any) {
      if (controller.signal.aborted) {
        logs.set((prev) => [...prev, "⏹ Execution stopped."], currentKey);
        return;
      }
      logs.set((prev) => [...prev, `❌ Run error: ${e.message}`], currentKey);
      throw e;
    } finally {
      if (runAbortRef.current === controller) runAbortRef.current = null;
      isRunning.set(false, currentKey);
      activeNodeId.set(undefined, currentKey);
      activeToolName.set(null, currentKey);
    }
  };

  const adoptCreatedExecution = (id: string, created: LangGraphAbstraction) => {
    justCreatedIdRef.current = id;
    graph.set(created, id);
    draftGraph.set(created, id);
    isEditing.set(true, id);
    logs.set([], id);
    onExecutionCreated(id);
  };

  return {
    isThinking: isThinking.value,
    isRunning: isRunning.value,
    graph: graph.value,
    setGraph: graph.set,
    isEditing: isEditing.value,
    setIsEditing: isEditing.set,
    draftGraph: draftGraph.value,
    setDraftGraph: draftGraph.set,
    adoptCreatedExecution,
    activeNodeId: activeNodeId.value,
    planningThought: planningThought.value,
    logs: logs.value,
    activity: activity.value,
    executionResult: executionResult.value,
    activeToolName: activeToolName.value,
    setExecutionResult: executionResult.set,
    handleGenerate,
    handleStop,
    handleStopRun,
    handleRun,
  };
}
