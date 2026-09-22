import { useState, useEffect } from "react";
import { VisualBuilder } from "./index";
import type { LangGraphAbstraction } from "../../types/execution";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useExecutions } from "../../context/ExecutionsContext";
import { generateExecution } from "../../lib/executions/generateExecution";
import { getExecution } from "../../lib/executions/getExecution";
import { API_URL } from "../../lib/config";

export function GraphExecutionView() {
  const { activeExecutionId, onExecutionCreated } = useExecutions();
  const [content, setContent] = useState("");
  const [graph, setGraph] = useState<LangGraphAbstraction | null>(null);
  const [loading, setLoading] = useState(false);
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
    setLoading(true);
    setLogs([]);
    setGraph(null);
    try {
      const { data } = await generateExecution({ content });
      if (!data) throw new Error("No data returned");

      setGraph(data.graph);
      setLogs([`Generated graph ID: ${data.graphId}`]);
      onExecutionCreated(String(data.executionId));
    } catch (e: any) {
      alert("Error: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRun = async () => {
    if (!activeExecutionId) return;
    setLoading(true);
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
          value={content}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setContent(e.target.value)
          }
          className="flex-1"
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
