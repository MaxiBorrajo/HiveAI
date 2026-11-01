import { postSse } from "@/lib/sse";
import type { PluginKind } from "../DraftEditorContext";

export interface TestChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface TestChatHandlers {
  onToolCall?: (data: { tool: string; input: unknown }) => void;
  onToolResult?: (data: { tool: string; ok: boolean; output?: string }) => void;
  onAnswer?: (content: string) => void;
  onError?: (message: string) => void;
}

/** Talks to one plugin only; drafts and installed plugins use different routes. */
export async function testChatStream(
  kind: PluginKind,
  name: string,
  message: string,
  history: TestChatTurn[],
  handlers: TestChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const base = kind === "draft" ? "drafts" : "plugins";
  await postSse(
    `/api/${base}/${encodeURIComponent(name)}/test-chat`,
    { message, history },
    (eventName, data) => {
      switch (eventName) {
        case "tool_call":
          handlers.onToolCall?.(data);
          break;
        case "tool_result":
          handlers.onToolResult?.(data);
          break;
        case "answer":
          handlers.onAnswer?.(data.content);
          break;
        case "error":
          handlers.onError?.(data.message);
          break;
      }
    },
    signal,
  );
}
