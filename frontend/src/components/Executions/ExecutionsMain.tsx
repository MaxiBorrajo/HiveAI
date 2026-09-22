import { useState, useEffect } from "react";
import { ChatInput } from "../Chat/ChatInput";
import { Logo } from "../Logo";
import { VisualBuilder } from "../VisualBuilder";
import { Button } from "../ui/button";
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
        prompt: input,
        model: "qwen2.5-coder:14b",
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

  const handleRun = async () => {
    if (!activeExecutionId) return;
    setIsThinking(true);
    setLogs((prev) => [...prev, "--- Starting Execution ---"]);

    try {
      const res = await fetch(
        `${API_URL}/api/executions/${activeExecutionId}/run`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: {} }),
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
                  onClick={handleRun}
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
    </div>
  );
}
