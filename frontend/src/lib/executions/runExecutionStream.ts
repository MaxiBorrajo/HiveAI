import { postSse } from "../sse";

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

export async function runExecutionStream(
  executionId: string,
  input: Record<string, any>,
  handlers: RunExecutionStreamHandlers,
): Promise<void> {
  await postSse(`/api/executions/${executionId}/run`, { input }, (eventName, data) => {
    if (eventName === "done" || data.result !== undefined) {
      handlers.onDone?.({
        iteration: data.iteration || 1,
        result: data.result,
        finalState: data.finalState,
      });
      return;
    }

    if (eventName === "error") {
      handlers.onError?.(data.message || "Unknown error");
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
