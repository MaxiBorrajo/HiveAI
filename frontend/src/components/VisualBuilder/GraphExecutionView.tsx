import { useState } from "react";
import { VisualBuilder } from "./index";
import type { LangGraphAbstraction } from "../../types/execution";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export function GraphExecutionView() {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("qwen2.5-coder:14b"); // default for testing
  const [graph, setGraph] = useState<LangGraphAbstraction | null>(null);
  const [executionId, setExecutionId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeNodeId, setActiveNodeId] = useState<string | undefined>(
    undefined,
  );
  const [logs, setLogs] = useState<string[]>([]);

  const handleGenerate = async () => {
    setLoading(true);
    setLogs([]);
    try {
      const res = await fetch("http://localhost:8000/api/executions/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, model }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setExecutionId(data.executionId);
      setGraph(data.graph);
      setLogs([`Generated graph ID: ${data.graphId}`]);
    } catch (e: any) {
      alert("Error: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRun = async () => {
    if (!executionId) return;
    setLoading(true);
    setLogs((prev) => [...prev, "--- Starting Execution ---"]);

    try {
      const res = await fetch(
        `http://localhost:8000/api/executions/${executionId}/run`,
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
                // highlight node? We need to parse data for that, but let's just log
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
      setLoading(false);
      setActiveNodeId(undefined);
    }
  };

  return (
    <div className="flex flex-col h-full gap-4 p-4">
      <div className="flex gap-2">
        <Input
          placeholder="I want an AI that analyzes sentiment..."
          value={prompt}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setPrompt(e.target.value)
          }
          className="flex-1"
        />
        <Input
          placeholder="Model name"
          value={model}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setModel(e.target.value)
          }
          className="w-48"
        />
        <Button onClick={handleGenerate} disabled={loading}>
          Generate Graph
        </Button>
      </div>

      {graph && (
        <div className="flex-1 flex gap-4 h-[500px]">
          <div className="flex-1 border rounded bg-white">
            <VisualBuilder graph={graph} activeNodeId={activeNodeId} />
          </div>
          <div className="w-80 flex flex-col gap-2">
            <Button onClick={handleRun} disabled={loading} variant="default">
              ▶ Run Execution
            </Button>
            <div className="flex-1 bg-black text-green-400 p-2 text-xs overflow-auto font-mono rounded">
              {logs.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
