import { useState, useEffect } from "react";
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
import { generateExecution } from "../../lib/executions/generateExecution";
import { API_URL } from "../../lib/config";

export function ExecutionsMain() {
  const { activeExecutionId, onExecutionCreated } = useExecutions();
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [graph, setGraph] = useState<LangGraphAbstraction | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | undefined>(
    undefined,
  );
  const [logs, setLogs] = useState<string[]>([]);

  // Run Modal State
  const [isRunModalOpen, setIsRunModalOpen] = useState(false);
  const [runInputs, setRunInputs] = useState<Record<string, any>>({});

  useEffect(() => {
    if (!activeExecutionId) {
      setGraph(null);
      setLogs([]);
      return;
    }

    getExecution(activeExecutionId)
      .then(({ data }) => {
        if (data?.graph?.graph) {
          setGraph(data.graph.graph);
        } else {
          setGraph(null);
        }
        setLogs([]);
      })
      .catch((e) => console.error("Failed to load execution graph", e));
  }, [activeExecutionId]);

  const handleGenerate = async () => {
    if (!input.trim()) return;
    setIsThinking(true);
    setLogs([]);
    setGraph(null);
    try {
      const { data } = await generateExecution({
        content: input,
        executionId: activeExecutionId ? Number(activeExecutionId) : undefined,
      });
      if (!data) throw new Error("No data returned");

      setGraph(data.graph);
      setLogs([`Generated graph ID: ${data.graphId}`]);
      onExecutionCreated(String(data.executionId));
    } catch (e: any) {
      // The API client already toasts errors if we don't silence them.
      // alert("Error: " + e.message);
    } finally {
      setIsThinking(false);
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
    setIsRunModalOpen(false);
    setIsThinking(true);
    setLogs((prev) => [...prev, "--- Starting Execution ---"]);

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
              ]);

              if (data.event === "on_node_start") {
                setActiveNodeId(data.name);
              } else if (data.event === "on_node_end") {
                setActiveNodeId(undefined);
              }
            }
          }
        }
      }
    } catch (e: any) {
      alert("Stream error: " + e.message);
    } finally {
      setIsThinking(false);
      setActiveNodeId(undefined);
    }
  };

  const isEmpty = !graph;

  return (
    <div className="flex flex-1 min-w-0 h-screen bg-background text-foreground font-sans overflow-hidden">
      <div className="flex flex-1 flex-col min-w-0 min-h-0 relative w-full">
        {isEmpty ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6">
            <div className="flex flex-col items-center gap-6 w-full max-w-3xl">
              <div className="flex items-center justify-center gap-3">
                <Logo size={40} />
                <h1 className="text-display text-3xl font-medium">
                  Welcome to the hive
                </h1>
              </div>
              <ChatInput
                input={input}
                setInput={setInput}
                isThinking={isThinking}
                handleSend={handleGenerate}
                isEmpty
                hidePluginsAndModes
                placeholder="I want a workflow that creates a report about..."
              />
              <p className="text-center text-xs text-muted-foreground mt-2">
                HiveAI can make mistakes. Consider verifying important
                information.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 flex gap-4 p-6 min-h-0">
              <div className="flex-1 border rounded bg-white overflow-hidden relative">
                <VisualBuilder graph={graph} activeNodeId={activeNodeId} />
              </div>
              <div className="w-80 flex flex-col gap-2">
                <Button
                  onClick={handleOpenRunModal}
                  disabled={isThinking}
                  variant="default"
                >
                  ▶ Run Execution
                </Button>
                <div className="flex-1 bg-black text-green-400 p-2 text-xs overflow-auto font-mono rounded">
                  {logs.map((l, i) => (
                    <div key={i}>{l}</div>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-6 py-4 pb-6 bg-background">
              <div className="mx-auto flex max-w-3xl flex-col items-center gap-2">
                <ChatInput
                  input={input}
                  setInput={setInput}
                  isThinking={isThinking}
                  handleSend={handleGenerate}
                  hidePluginsAndModes
                  placeholder="I want a workflow that creates a report about..."
                />
                <p className="text-center text-xs text-muted-foreground">
                  HiveAI can make mistakes. Consider verifying important
                  information.
                </p>
              </div>
            </div>
          </>
        )}
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
