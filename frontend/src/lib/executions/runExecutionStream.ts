import { apiClient } from "../apiClient";
import { readSseStream } from "../sse";

export interface RunExecutionStreamHandlers {
  onDone?: (data: {
    iteration?: number;
    result: any;
    finalState?: Record<string, any>;
  }) => void;
  onError?: (message: string) => void;
  onNodeStart?: (nodeName: string) => void;
  onToolStart?: (toolName: string | null) => void;
  onToolEnd?: (toolName: string | null) => void;
}

/**
 * Streams a running execution's server-sent events, reusing the same
 * `readSseStream` parser as `generateExecutionStream` instead of
 * hand-rolling a second SSE reader. The backend emits both dedicated
 * `done`/`error` events and raw LangGraph callback events (e.g.
 * `on_chain_start`, `on_tool_start`, `on_tool_end`) under an `event`
 * field on the payload itself — this normalizes both shapes into the
 * handlers above.
 */
export async function runExecutionStream(
  executionId: string,
  input: Record<string, any>,
  handlers: RunExecutionStreamHandlers,
): Promise<void> {
  const response = await apiClient.post(
    `/api/executions/${executionId}/run`,
    { input },
    {
      responseType: "stream",
      adapter: "fetch",
    },
  );

  if (!response.data) {
    throw new Error("The backend responded with no body");
  }

  await readSseStream(response.data, (eventName, data) => {
    if (eventName === "done" || data.result !== undefined) {
      handlers.onDone?.({
        iteration: data.iteration || 1,
        result: data.result,
        finalState: data.finalState,
      });
      return;
    }

    if (eventName === "error") {
      handlers.onError?.(data.error || "Unknown error");
      return;
    }

    const evtType = data.event || eventName;
    const nodeName =
      data.metadata?.langgraph_node ||
      (data.name && data.name !== "LangGraph" ? data.name : null);

    if (evtType === "on_chain_start" && nodeName) {
      handlers.onNodeStart?.(nodeName);
    } else if (evtType === "on_tool_start") {
      handlers.onToolStart?.(data.name || null);
    } else if (evtType === "on_tool_end") {
      handlers.onToolEnd?.(data.name || null);
    }
  });
}
