import { postSse } from "../../../lib/sse";
import type { JudgeChoice } from "../types.ts";

export type JudgeFocus = "overview" | "result" | "tokens" | "nodes";

export interface JudgeChatHandlers {
  onChatCreated: (chatId: number) => void;
  onToolCalls: (names: string[]) => void;
  onToken: (content: string) => void;
  onDone: (content: string) => void;
  onError: (message: string) => void;
}

export async function judgeChat(
  executionId: string,
  body: {
    message: string;
    chatId: number | null;
    historyIds: number[];
    judge: JudgeChoice;
    focus?: JudgeFocus;
  },
  handlers: JudgeChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  await postSse(
    `/api/executions/${executionId}/judge-chat`,
    { ...body, chatId: body.chatId ?? undefined },
    (eventName, payload) => {
      if (eventName === "chat_created") {
        handlers.onChatCreated(Number(payload.chatId));
      } else if (eventName === "tool_calls") {
        handlers.onToolCalls((payload.calls ?? []).map((c: { name: string }) => c.name));
      } else if (eventName === "token") {
        handlers.onToken(payload.content);
      } else if (eventName === "done") {
        handlers.onDone(payload.content);
      } else if (eventName === "error") {
        handlers.onError(payload.message);
      }
    },
    signal,
  );
}
