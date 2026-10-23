import { postSse } from "../../../lib/sse";

export interface RunExecutionStreamHandlers {
  onDone?: (data: {
    iteration?: number;
    historyId?: number;
    result: any;
    finalState?: Record<string, any>;
  }) => void;
  onError?: (message: string) => void;
  onWarning?: (messages: string[]) => void;
  onNodeStart?: (nodeName: string) => void;
  onToolStart?: (toolName: string | null) => void;
  onToolEnd?: (toolName: string | null) => void;
  onToken?: (nodeName: string | null, text: string) => void;
}

export async function runExecutionStream(
  executionId: string,
  input: Record<string, any>,
  attachmentIds: number[],
  handlers: RunExecutionStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  await postSse(`/api/executions/${executionId}/run`, { input, attachmentIds }, (eventName, data) => {
    if (eventName === "done" || data.result !== undefined) {
      handlers.onDone?.({
        iteration: data.iteration || 1,
        historyId: data.historyId,
        result: data.result,
        finalState: data.finalState,
      });
      return;
    }

    if (eventName === "warning") {
      const list = Array.isArray(data.warnings) ? data.warnings : [];
      handlers.onWarning?.(
        list.map((w: { reason?: string }) => w.reason).filter(Boolean),
      );
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
    } else if (evtType === "on_chat_model_stream") {
      const content = data.data?.chunk?.kwargs?.content ?? data.data?.chunk?.content;
      const text = Array.isArray(content)
        ? content
            .filter((b: { type?: string }) => b?.type === "text")
            .map((b: { text?: string }) => b.text ?? "")
            .join("")
        : content;
      if (typeof text === "string" && text) {
        handlers.onToken?.(data.metadata?.langgraph_node || null, text);
      }
    }
  }, signal);
}
