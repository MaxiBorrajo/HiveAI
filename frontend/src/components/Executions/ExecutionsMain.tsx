import { useState, useEffect } from "react";
import { ChatInput } from "../Chat/ChatInput";
import { Logo } from "../Logo";
import { VisualBuilder } from "../VisualBuilder";
import { useExecutions } from "../../context/ExecutionsContext";
import { useKeyedState } from "@/lib/useKeyedState";
import { useExecutionWorkspace } from "./useExecutionWorkspace";
import { RunExecutionModal } from "./RunExecutionModal";
import { ExecutionResultSidebar } from "./ExecutionResultSidebar";
import { Play, Loader2, Terminal, CircleCheckBig, SlidersHorizontal, Copy, Check } from "lucide-react";
import { cn } from "../../lib/utils";
import { reportError } from "@/lib/toastManager";
import { getErrorMessage } from "@/lib/errors";
import { useCopyFeedback } from "@/lib/useCopyFeedback";
import { graphRequiresInput } from "@/lib/executions/inputs";

export function ExecutionsMain() {
  const {
    executions,
    activeExecutionId,
    onExecutionCreated,
    newExecutionToken,
  } = useExecutions();
  const [input, setInput] = useState("");
  const key = activeExecutionId || newExecutionToken;

  const selectedNodeIdState = useKeyedState<string | null>(key, null);
  const selectedEdgeIdState = useKeyedState<string | null>(key, null);
  const selectedNodeId = selectedNodeIdState.value;
  const selectedEdgeId = selectedEdgeIdState.value;
  const setSelectedNodeId = selectedNodeIdState.set;
  const setSelectedEdgeId = (id: string | null) => selectedEdgeIdState.set(id);

  const [isResultSidebarOpen, setIsResultSidebarOpen] = useState(false);
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const [isRunModalOpen, setIsRunModalOpen] = useState(false);
  const [runInputs, setRunInputs] = useState<Record<string, any>>({});
  const { copied: isCopied, copy: copyText } = useCopyFeedback();

  const {
    isThinking,
    isRunning,
    graph,
    activeNodeId,
    planningThought,
    logs,
    executionResult,
    activeToolName,
    handleGenerate,
    handleStop,
    handleRun: runExecution,
  } = useExecutionWorkspace({
    key,
    activeExecutionId,
    newExecutionToken,
    selectedNodeId,
    setSelectedNodeId,
    onExecutionCreated,
  });

  const handleCopyGraph = () => {
    if (!graph) return;
    copyText(JSON.stringify(graph, null, 2));
  };

  const handleGenerateClick = async () => {
    if (!input.trim()) return;
    const userPrompt = input;
    setInput("");
    await handleGenerate(userPrompt);
  };

  const hasRequiredInputs = graphRequiresInput(graph);

  const handleOpenRunModal = () => {
    if (!graph) return;
    const initialInputs: Record<string, any> = {};
    Object.keys(graph.stateSchema || {}).forEach((key) => {
      initialInputs[key] = "";
    });
    setRunInputs(initialInputs);
    setIsRunModalOpen(true);
  };

  const handleRun = async (overrideInputs?: Record<string, any>) => {
    setIsRunModalOpen(false);

    try {
      await runExecution(overrideInputs ?? runInputs, () => setIsResultSidebarOpen(true));
    } catch (e: any) {
      reportError([`Stream error: ${getErrorMessage(e)}`]);
    }
  };

  const handleRunClick = () => {
    if (hasRequiredInputs) {
      handleOpenRunModal();
    } else {
      handleRun({});
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (!isThinking && !isRunning && graph) {
          e.preventDefault();
          handleRunClick();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isThinking, isRunning, graph, hasRequiredInputs]);

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
            activeToolName={activeToolName}
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


          {/* Split Controller Segmented Button (Option 3) */}
          {(!isEmpty || isThinking || isRunning) && (
            <div className="absolute top-6 right-6 z-20 pointer-events-auto flex flex-col items-end gap-2">
              {/* Segmented Controller Block */}
              <div className="inline-flex items-stretch rounded-xl bg-zinc-950/90 border border-zinc-800 shadow-2xl backdrop-blur-md overflow-hidden divide-x divide-zinc-800/80">
                {/* Segment: Run Execution */}
                <button
                  type="button"
                  onClick={handleRunClick}
                  disabled={isThinking || isRunning}
                  className={cn(
                    "group flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium transition-all select-none",
                    isRunning
                      ? "bg-amber-500/10 text-amber-300 cursor-wait"
                      : "text-zinc-200 hover:bg-zinc-900/90 hover:text-white active:bg-zinc-800",
                    (isThinking || isRunning) && !isRunning && "opacity-50 cursor-not-allowed"
                  )}
                  title={hasRequiredInputs ? "Configure & Run Execution" : "Run Execution"}
                >
                  {isRunning ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin text-amber-400" />
                      <span>Running...</span>
                    </>
                  ) : (
                    <>
                      <Play className="size-3.5 fill-emerald-400 text-emerald-400 transition-transform group-hover:scale-110" />
                      <span className="font-medium">Run Execution</span>
                    </>
                  )}
                </button>

                {/* Optional Parameters Launcher */}
                {!hasRequiredInputs && !isRunning && (
                  <button
                    type="button"
                    onClick={handleOpenRunModal}
                    disabled={isThinking}
                    className="flex items-center justify-center px-2 py-2 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 transition-all border-l border-zinc-800/80 cursor-pointer"
                    title="Run with Custom Parameters..."
                  >
                    <SlidersHorizontal className="size-3.5" />
                  </button>
                )}

                {/* Segment: Result */}
                {executionResult && (
                  <button
                    type="button"
                    onClick={() => setIsResultSidebarOpen(true)}
                    className="group flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-emerald-400 hover:bg-emerald-500/10 active:bg-emerald-500/20 transition-all"
                    title="View Execution Result & State"
                  >
                    <CircleCheckBig className="size-3.5 text-emerald-400 transition-transform group-hover:scale-110" />
                    <span>Result</span>
                  </button>
                )}

                {/* Segment: Logs Toggle */}
                <button
                  type="button"
                  onClick={() => setIsLogsOpen(!isLogsOpen)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-all select-none cursor-pointer",
                    isLogsOpen
                      ? "bg-zinc-800/90 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-900/90 hover:text-zinc-200"
                  )}
                  title="Toggle Execution Logs"
                >
                  <Terminal className="size-3.5" />
                  <span>Logs</span>
                  {logs.length > 0 && (
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-zinc-800 text-zinc-400">
                      {logs.length}
                    </span>
                  )}
                </button>

                {/* Segment: Copy Graph JSON */}
                {graph && (
                  <button
                    type="button"
                    onClick={handleCopyGraph}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-400 hover:bg-zinc-900/90 hover:text-zinc-200 active:bg-zinc-800 transition-all select-none cursor-pointer"
                    title="Copy full Graph JSON to clipboard"
                  >
                    {isCopied ? (
                      <>
                        <Check className="size-3.5 text-emerald-400" />
                        <span className="text-emerald-400 font-medium">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="size-3.5" />
                        <span>Copy JSON</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Execution Logs Drawer (drops down under the split controller) */}
              {isLogsOpen && logs.length > 0 && (
                <div className="w-80 bg-zinc-950/95 text-emerald-400 p-2.5 text-xs overflow-auto font-mono rounded-xl shadow-2xl border border-zinc-800/90 max-h-64 backdrop-blur-md animate-in fade-in-50 slide-in-from-top-2 duration-150">
                  <div className="text-[10px] uppercase font-bold text-zinc-500 mb-1.5 tracking-wider flex items-center justify-between border-b border-zinc-800/80 pb-1">
                    <div className="flex items-center gap-1.5 text-zinc-400">
                      <Terminal className="size-3" />
                      <span>Console Logs</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-zinc-500 font-mono">{logs.length} lines</span>
                      <button
                        type="button"
                        onClick={() => setIsLogsOpen(false)}
                        className="text-zinc-500 hover:text-zinc-300 text-xs px-1 hover:bg-zinc-800 rounded transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    {logs.map((l, i) => (
                      <div key={i} className="leading-relaxed break-words font-mono">{l}</div>
                    ))}
                  </div>
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
                  handleSend={handleGenerateClick}
                  handleStop={handleStop}
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

      <RunExecutionModal
        open={isRunModalOpen}
        onOpenChange={setIsRunModalOpen}
        graph={graph}
        hasRequiredInputs={hasRequiredInputs}
        runInputs={runInputs}
        setRunInputs={setRunInputs}
        onRun={() => handleRun()}
      />

      {/* Execution Deliverable / Result Slide-Over Sidebar */}
      <ExecutionResultSidebar
        isOpen={isResultSidebarOpen}
        onClose={() => setIsResultSidebarOpen(false)}
        data={executionResult}
        executionName={executions.find((e) => String(e.id) === activeExecutionId)?.name}
        onRunAgain={handleRunClick}
      />
    </div>
  );
}
