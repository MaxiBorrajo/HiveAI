import React, { useState, useEffect } from "react";
import { ChatInput } from "../Chat/ChatInput";
import { Logo } from "../Logo";
import { VisualBuilder } from "../VisualBuilder";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../ui/dialog";
import { useExecutions } from "../../context/ExecutionsContext";
import type { LangGraphAbstraction } from "../../types/execution";
import { getExecution } from "../../lib/executions/getExecution";
import { generateExecutionStream } from "../../lib/executions/generateExecution";
import { API_URL } from "../../lib/config";

export function ExecutionsMain() {
  const { activeExecutionId, onExecutionCreated, newExecutionToken } = useExecutions();
  const [input, setInput] = useState("");

  const key = activeExecutionId || newExecutionToken;
  const justCreatedIdRef = React.useRef<string | null>(null);

  const [isThinkingMap, setIsThinkingMap] = useState<Record<string, boolean>>({});
  const [graphMap, setGraphMap] = useState<Record<string, LangGraphAbstraction | null>>({});
  const [activeNodeIdMap, setActiveNodeIdMap] = useState<Record<string, string | undefined>>({});
  const [selectedNodeIdMap, setSelectedNodeIdMap] = useState<Record<string, string | null>>({});
  const [selectedEdgeIdMap, setSelectedEdgeIdMap] = useState<Record<string, string | null>>({});
  const [planningThoughtMap, setPlanningThoughtMap] = useState<Record<string, string | null>>({});
  const [logsMap, setLogsMap] = useState<Record<string, string[]>>({});

  const isThinking = isThinkingMap[key] || false;
  const graph = graphMap[key] || null;
  const activeNodeId = activeNodeIdMap[key] || undefined;
  const selectedNodeId = selectedNodeIdMap[key] || null;
  const selectedEdgeId = selectedEdgeIdMap[key] || null;
  const setSelectedEdgeId = (id: string | null) => setSelectedEdgeIdMap((prev) => ({ ...prev, [key]: id }));
  const planningThought = planningThoughtMap[key] || null;
  const logs = logsMap[key] || [];

  const setIsThinking = (val: boolean | ((prev: boolean) => boolean), targetKey = key) => {
    setIsThinkingMap(prev => ({ ...prev, [targetKey]: typeof val === 'function' ? val(prev[targetKey] || false) : val }));
  };
  const setGraph = (val: LangGraphAbstraction | null | ((prev: LangGraphAbstraction | null) => LangGraphAbstraction | null), targetKey = key) => {
    setGraphMap(prev => ({ ...prev, [targetKey]: typeof val === 'function' ? val(prev[targetKey] || null) : val }));
  };
  const setActiveNodeId = (val: string | undefined | ((prev: string | undefined) => string | undefined), targetKey = key) => {
    setActiveNodeIdMap(prev => ({ ...prev, [targetKey]: typeof val === 'function' ? val(prev[targetKey] || undefined) : val }));
  };
  const setSelectedNodeId = (val: string | null | ((prev: string | null) => string | null), targetKey = key) => {
    setSelectedNodeIdMap(prev => ({ ...prev, [targetKey]: typeof val === 'function' ? val(prev[targetKey] || null) : val }));
  };
  const setPlanningThought = (val: string | null | ((prev: string | null) => string | null), targetKey = key) => {
    setPlanningThoughtMap(prev => ({ ...prev, [targetKey]: typeof val === 'function' ? val(prev[targetKey] || null) : val }));
  };
  const setLogs = (val: string[] | ((prev: string[]) => string[]), targetKey = key) => {
    setLogsMap(prev => ({ ...prev, [targetKey]: typeof val === 'function' ? val(prev[targetKey] || []) : val }));
  };

  // Run Modal State
  const [isRunModalOpen, setIsRunModalOpen] = useState(false);
  const [runInputs, setRunInputs] = useState<Record<string, any>>({});

  useEffect(() => {
    if (!activeExecutionId) {
      if (justCreatedIdRef.current === null) {
        // Only clear if we didn't just create one
      }
      return;
    }

    if (justCreatedIdRef.current === activeExecutionId) {
      justCreatedIdRef.current = null;
      return;
    }

    // Only load if we haven't loaded it yet
    if (graphMap[activeExecutionId] !== undefined) return;

    getExecution(activeExecutionId)
      .then(({ data }) => {
        if (data?.graph?.graph) {
          setGraph(data.graph.graph, activeExecutionId);
        } else {
          setGraph(null, activeExecutionId);
        }
        setLogs([], activeExecutionId);
        setSelectedNodeId(null, activeExecutionId);
      })
      .catch((e) => console.error("Failed to load execution graph", e));
  }, [activeExecutionId, key, graphMap]);

  const handleGenerate = async () => {
    if (!input.trim()) return;
    const userPrompt = input;
    setInput("");
    let currentKey = key;
    setIsThinking(true, currentKey);
    setPlanningThought(null, currentKey);
    setLogs(["Pollinating flow: starting design..."], currentKey);

    // If starting a brand new execution, reset graph so canvas displays incremental stream
    if (!activeExecutionId && !selectedNodeId) {
      setGraph(null, currentKey);
    }

    try {
      await generateExecutionStream(
        {
          content: userPrompt,
          executionId: activeExecutionId
            ? Number(activeExecutionId)
            : undefined,
          targetNodeId: selectedNodeId ?? undefined,
        },
        {
          onExecutionCreated: (id) => {
            const newId = String(id);
            justCreatedIdRef.current = newId;
            
            // Move state
            setIsThinkingMap(prev => { const { [currentKey]: v, ...rest } = prev; return { ...rest, [newId]: v }; });
            setGraphMap(prev => { const { [currentKey]: v, ...rest } = prev; return { ...rest, [newId]: v }; });
            setActiveNodeIdMap(prev => { const { [currentKey]: v, ...rest } = prev; return { ...rest, [newId]: v }; });
            setLogsMap(prev => { const { [currentKey]: v, ...rest } = prev; return { ...rest, [newId]: v }; });
            
            currentKey = newId;
            onExecutionCreated(newId);
          },
          onPlanning: (thoughts) => {
            setPlanningThought(thoughts, currentKey);
            setLogs((prev) => [...prev, ` ${thoughts}`], currentKey);
          },
          onNodeAdded: ({ node, edge, stateProperties }) => {
            setPlanningThought(null, currentKey);
            setGraph((prev) => {
              const current = prev || { nodes: [], edges: [], stateSchema: {} };
              if (current.nodes.some((n) => n.id === node.id)) {
                return current;
              }
              const updatedNodes = [...current.nodes, node];
              const updatedEdges = edge
                ? [...current.edges, edge]
                : current.edges;
              const updatedSchema = {
                ...current.stateSchema,
                ...(stateProperties || {}),
              };
              return {
                nodes: updatedNodes,
                edges: updatedEdges,
                stateSchema: updatedSchema,
              };
            }, currentKey);
            setLogs((prev) => [
              ...prev,
              `+ Built node: ${node.name} (${node.type})`,
            ], currentKey);
          },
          onNodeUpdated: ({ node, stateProperties }) => {
            setPlanningThought(null, currentKey);
            setGraph((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                nodes: prev.nodes.map((n) => (n.id === node.id ? node : n)),
                stateSchema: {
                  ...prev.stateSchema,
                  ...(stateProperties || {}),
                },
              };
            }, currentKey);
            setLogs((prev) => [...prev, `* Node updated: ${node.name}`], currentKey);
            setSelectedNodeId(null, activeExecutionId || newExecutionToken);
          },
          onDone: (data) => {
            setPlanningThought(null, currentKey);
            setGraph(data.graph, currentKey);
            setLogs((prev) => [...prev, "✨ Flow assembled successfully!"], currentKey);
            setIsThinking(false, currentKey);
          },
          onError: (message) => {
            setPlanningThought(null, currentKey);
            setLogs((prev) => [...prev, `❌ Error: ${message}`], currentKey);
            setIsThinking(false, currentKey);
          },
        },
      );
    } catch (e: any) {
      // The API client already toasts errors if we don't silence them.
      // alert("Error: " + e.message);
      setPlanningThought(null, currentKey);
      setLogs((prev) => [...prev, `❌ Streaming error: ${e.message}`], currentKey);
    } finally {
      setIsThinking(false, currentKey);
      setPlanningThought(null, currentKey);
      setInput("");
    }
  };

  const handleOpenRunModal = () => {
    if (!graph) return;
    const initialInputs: Record<string, any> = {};
    Object.keys(graph.stateSchema || {}).forEach((key) => {
      initialInputs[key] = "";
    });
    setRunInputs(initialInputs);
    setIsRunModalOpen(true);
  };

  const handleRun = async () => {
    if (!activeExecutionId) return;
    const currentKey = activeExecutionId;
    setIsRunModalOpen(false);
    setIsThinking(true, currentKey);
    setLogs((prev) => [...prev, "--- Starting Execution ---"], currentKey);

    // Clean up empty strings from runInputs so we don't override defaults with ""
    const finalInputs = { ...runInputs };
    Object.keys(finalInputs).forEach((key) => {
      if (finalInputs[key] === "") {
        delete finalInputs[key];
      }
    });

    try {
      const res = await fetch(
        `${API_URL}/api/executions/${activeExecutionId}/run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: finalInputs }),
        },
      );

      if (!res.body) throw new Error("No body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");

      let done = false;
      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          const chunk = decoder.decode(value);
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              const eventName = line.replace("event: ", "").trim();
              if (
                eventName.startsWith("on_node_start") ||
                eventName.startsWith("on_chat_model_start")
              ) {
                // handle logic
              }
            } else if (line.startsWith("data: ")) {
              const dataStr = line.replace("data: ", "").trim();
              if (!dataStr) continue;
              const data = JSON.parse(dataStr);
              setLogs((prev) => [
                ...prev,
                `[${data.event}] ${data.name || ""}`,
              ], currentKey);

              if (
                data.event === "on_chain_start" &&
                data.name &&
                data.name !== "LangGraph"
              ) {
                setActiveNodeId(data.name, currentKey);
              } else if (
                data.event === "on_chain_end" &&
                data.name &&
                data.name === activeNodeId
              ) {
                // Keep the last active node visible briefly or let the next chain_start override it
              }
            }
          }
        }
      }
    } catch (e: any) {
      alert("Stream error: " + e.message);
    } finally {
      setIsThinking(false, currentKey);
      setActiveNodeId(undefined, currentKey);
    }
  };

  const isEmpty = !graph && !isThinking;
  const selectedNode = graph?.nodes.find((n) => n.id === selectedNodeId);
  const selectedEdge = graph?.edges.find((e) => e.id === selectedEdgeId);

  return (
    <div className="flex flex-1 min-w-0 h-screen bg-background text-foreground font-sans overflow-hidden">
      <div className="flex flex-1 flex-col min-w-0 min-h-0 relative w-full">
        {/* Background Canvas Layer */}
        <div className="absolute inset-0 z-0">
          <VisualBuilder
            graph={graph}
            activeNodeId={activeNodeId}
            isGenerating={isThinking}
            planningThought={planningThought}
            selectedNodeId={selectedNodeId}
            onNodeSelect={setSelectedNodeId}
            selectedEdgeId={selectedEdgeId}
            onEdgeSelect={setSelectedEdgeId}
          />
        </div>

        {/* Foreground UI Layer */}
        <div className="absolute inset-0 z-10 pointer-events-none flex flex-col justify-between">
          {/* Top/Center section (Welcome message if empty) */}
          <div className="flex items-center justify-end my-3 mx-4">
            {isEmpty && (
              <div className="flex items-center justify-center gap-1">
                <Logo size={20} />
                <h1 className="text-display text-lg font-medium">HiveAI</h1>
              </div>
            )}
          </div>

          {/* Floating panel for Run/Logs (when not empty) */}

          {(!isEmpty || isThinking) && (
            <div className="absolute top-6 right-6 w-80 flex flex-col gap-2 pointer-events-auto max-h-[calc(100vh-200px)]">
              <Button
                onClick={handleOpenRunModal}
                disabled={isThinking}
                variant="default"
                className="shadow-lg"
              >
                ▶ Run Execution
              </Button>
              {logs.length > 0 && (
                <div className="bg-black/90 text-green-400 p-2 text-xs overflow-auto font-mono rounded shadow-lg max-h-64 border border-zinc-800">
                  {logs.map((l, i) => (
                    <div key={i}>{l}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Node or Edge Details Panel */}
          {(selectedNode || selectedEdge) && (
            <div className="absolute top-6 left-6 w-80 flex flex-col gap-2 pointer-events-auto max-h-[calc(100vh-200px)] bg-background/95 p-4 rounded-xl shadow-lg border border-border backdrop-blur-sm overflow-auto">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-medium text-foreground text-sm">
                  {selectedNode ? "Node Details" : "Edge Details"}
                </h3>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                  {selectedNode ? selectedNode.type : "edge"}
                </span>
              </div>
              <div className="space-y-3">
                {selectedNode ? (
                  <>
                    <div>
                      <label className="text-[10px] text-muted-foreground uppercase font-semibold">
                        ID
                      </label>
                      <p className="text-sm font-mono">{selectedNode.id}</p>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground uppercase font-semibold">
                        Name
                      </label>
                      <p className="text-sm">{selectedNode.name}</p>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground uppercase font-semibold">
                        Config
                      </label>
                      <pre className="text-xs bg-black/50 p-2 rounded border border-white/5 overflow-x-auto text-zinc-300 mt-1 break-all whitespace-pre-wrap">
                        {JSON.stringify(selectedNode.config, null, 2)}
                      </pre>
                    </div>
                  </>
                ) : selectedEdge ? (
                  <>
                    <div>
                      <label className="text-[10px] text-muted-foreground uppercase font-semibold">
                        SOURCE ➔ TARGET
                      </label>
                      <p className="text-sm font-mono break-all">{selectedEdge.source} ➔ {selectedEdge.target}</p>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground uppercase font-semibold">
                        IS CONDITIONAL
                      </label>
                      <p className="text-sm">{selectedEdge.isConditional ? "Yes" : "No"}</p>
                    </div>
                    {selectedEdge.condition && (
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase font-semibold">
                          CONDITION
                        </label>
                        <pre className="text-xs bg-black/50 p-2 rounded border border-white/5 overflow-x-auto text-zinc-300 mt-1 break-all whitespace-pre-wrap">
                          {JSON.stringify(selectedEdge.condition, null, 2)}
                        </pre>
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            </div>
          )}

          {/* Bottom section with Chat Input */}
          {(isEmpty || selectedNodeId) && (
            <div className="w-full px-6 pt-12 pb-8">
              <div className="mx-auto flex max-w-3xl flex-col items-center gap-2 pointer-events-auto">
                {(selectedNode || selectedEdge) && (
                  <div className="flex items-center gap-2 px-3 py-1 bg-primary/20 border border-primary/40 rounded-full text-xs text-primary shadow">
                    <span>
                      Editing {selectedNode ? 'node' : 'edge'}: <strong>{selectedNode ? selectedNode.name : selectedEdge?.id}</strong>
                      {selectedNode ? ` (${selectedNode.type})` : ''}
                    </span>
                    <button
                      onClick={() => setSelectedNodeId(null)}
                      className="hover:text-white ml-1 font-bold"
                    >
                      ✕
                    </button>
                  </div>
                )}
                <ChatInput
                  input={input}
                  setInput={setInput}
                  isThinking={isThinking}
                  handleSend={handleGenerate}
                  isEmpty={isEmpty}
                  hidePluginsAndModes
                  placeholder={
                    selectedNode
                      ? `Specify how you want to modify "${selectedNode.name}"...`
                      : "I want a flow that researches a topic and generates a report..."
                  }
                />
                <p className="text-center text-xs text-muted-foreground mt-2">
                  HiveAI can make mistakes. Consider verifying important
                  information.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Run Input Modal */}
      <Dialog open={isRunModalOpen} onOpenChange={setIsRunModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start Execution</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            {graph?.stateSchema &&
              Object.entries(graph.stateSchema)
                .filter(([key]) => key === "input")
                .map(([key, def]: [string, any]) => (
                  <div key={key} className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-foreground">
                      User Prompt
                    </label>
                    <Textarea
                      placeholder={
                        def.description || "What should the agent do?"
                      }
                      value={runInputs[key] || ""}
                      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                        setRunInputs((prev) => ({
                          ...prev,
                          [key]: e.target.value,
                        }))
                      }
                      className="min-h-[100px]"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      {def.description}
                    </p>
                  </div>
                ))}
            {graph?.stateSchema && !graph.stateSchema["input"] && (
              <p className="text-sm text-yellow-600">
                Warning: The graph does not have a standard 'input' property
                defined in its state schema.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRunModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRun}>Run</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
