import { useEffect, useRef } from "react";
import { useKeyedState } from "@/lib/useKeyedState";
import { getExecution } from "@/lib/executions/getExecution";
import { generateExecutionStream } from "@/lib/executions/generateExecution";
import { runExecutionStream } from "@/lib/executions/runExecutionStream";
import type { LangGraphAbstraction, ExecutionResultData } from "@/types/execution";

export interface ExecutionWorkspaceOptions {
  key: string;
  activeExecutionId: string | null;
  newExecutionToken: string;
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null, targetKey?: string) => void;
  onExecutionCreated: (id: string) => void;
}

/**
 * Owns all per-execution UI state that used to live as 10 parallel
 * `Record<string, T>` maps directly inside ExecutionsMain (isThinking,
 * isRunning, graph, activeNodeId, planningThought, logs, executionResult,
 * activeToolName — each keyed by execution id / new-execution token so
 * switching between executions doesn't lose in-flight state), plus the two
 * business-logic flows built on top of it: generating a graph (SSE) and
 * running an execution (SSE). ExecutionsMain is left to just render.
 */
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
  const activeNodeId = useKeyedState<string | undefined>(key, undefined);
  const planningThought = useKeyedState<string | null>(key, null);
  const logs = useKeyedState<string[]>(key, []);
  const executionResult = useKeyedState<ExecutionResultData | null>(key, null);
  const activeToolName = useKeyedState<string | null>(key, null);

  const moveAllKeys = (from: string, to: string) =>
    [
      isThinking,
      isRunning,
      graph,
      activeNodeId,
      planningThought,
      logs,
      executionResult,
      activeToolName,
    ].forEach((state) => state.moveKey(from, to));

  useEffect(() => {
    if (!activeExecutionId) return;

    if (justCreatedIdRef.current === activeExecutionId) {
      justCreatedIdRef.current = null;
      return;
    }

    // Only load if we haven't loaded it yet
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

  const handleStop = () => generateAbortRef.current?.abort();

  const handleGenerate = async (userPrompt: string) => {
    const controller = new AbortController();
    generateAbortRef.current = controller;
    let currentKey = key;
    isThinking.set(true, currentKey);
    planningThought.set(null, currentKey);
    logs.set(["Pollinating flow: starting design..."], currentKey);

    // If starting a brand new execution, reset graph so canvas displays incremental stream
    if (!activeExecutionId && !selectedNodeId) {
      graph.set(null, currentKey);
    }

    try {
      await generateExecutionStream(
        {
          content: userPrompt,
          executionId: activeExecutionId ? Number(activeExecutionId) : undefined,
          targetNodeId: selectedNodeId ?? undefined,
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
          },
          onNodeAdded: ({ node, edge, stateProperties }) => {
            planningThought.set(null, currentKey);
            graph.set((prev) => {
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
          },
          onNodeConfiguring: ({ nodeName }) => {
            logs.set((prev) => [...prev, `⚙️ Configuring node: ${nodeName}...`], currentKey);
          },
          onNodeUpdated: ({ node, stateProperties }) => {
            planningThought.set(null, currentKey);
            activeNodeId.set(undefined, currentKey);
            graph.set((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                nodes: prev.nodes.map((n) => (n.id === node.id ? node : n)),
                stateSchema: { ...prev.stateSchema, ...(stateProperties || {}) },
              };
            }, currentKey);
            logs.set((prev) => [...prev, `✨ Configured: ${node.name}`], currentKey);
            setSelectedNodeId(null, activeExecutionId || newExecutionToken);
          },
          onDone: (data) => {
            activeNodeId.set(undefined, currentKey);
            planningThought.set(null, currentKey);
            graph.set(data.graph, currentKey);
            logs.set((prev) => [...prev, "✨ Flow assembled successfully!"], currentKey);
            isThinking.set(false, currentKey);
          },
          onError: (message) => {
            planningThought.set(null, currentKey);
            logs.set((prev) => [...prev, `❌ Error: ${message}`], currentKey);
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
    isRunning.set(true, currentKey);
    logs.set((prev) => [...prev, "--- Starting Execution ---"], currentKey);

    // Clean up empty strings from inputs so we don't override defaults with ""
    const finalInputs = { ...inputs };
    Object.keys(finalInputs).forEach((k) => {
      if (finalInputs[k] === "") delete finalInputs[k];
    });

    try {
      await runExecutionStream(activeExecutionId, finalInputs, {
        onDone: (data) => {
          const resultData: ExecutionResultData = {
            iteration: data.iteration,
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
      });
    } catch (e: any) {
      logs.set((prev) => [...prev, `❌ Run error: ${e.message}`], currentKey);
      throw e;
    } finally {
      isRunning.set(false, currentKey);
      activeNodeId.set(undefined, currentKey);
      activeToolName.set(null, currentKey);
    }
  };

  return {
    isThinking: isThinking.value,
    isRunning: isRunning.value,
    graph: graph.value,
    activeNodeId: activeNodeId.value,
    planningThought: planningThought.value,
    logs: logs.value,
    executionResult: executionResult.value,
    activeToolName: activeToolName.value,
    setExecutionResult: executionResult.set,
    handleGenerate,
    handleStop,
    handleRun,
  };
}
