import { postSse } from "../../../lib/sse";
import type {
  ChatStep,
  ConversationUsage,
  MessageUsage,
} from "@/features/chats/types";

export interface StreamHandlers {
  onChatCreated: (chatId: string) => void;
  onThinking: () => void;
  onThinkingDelta: (content: string, node: string | undefined) => void;
  onToken: (content: string) => void;
  onDone: (
    content: string,
    usedTools: string[],
    steps: ChatStep[],
    usage: MessageUsage | null,
    conversationUsage: ConversationUsage | null,
  ) => void;
  onError: (message: string) => void;
}

export async function sendMessage(
  chatId: string | null,
  content: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  await postSse(
    "/api/chats",
    { chatId: chatId ?? undefined, message: content },
    (eventName, payload) => {
      if (eventName === "chat_created") {
        handlers.onChatCreated(payload.chatId);
      } else if (eventName === "thinking") {
        handlers.onThinking();
      } else if (eventName === "thinking_delta") {
        handlers.onThinkingDelta(payload.content, payload.node);
      } else if (eventName === "token") {
        handlers.onToken(payload.content);
      } else if (eventName === "done") {
        handlers.onDone(
          payload.content,
          payload.usedTools ?? [],
          payload.steps ?? [],
          payload.usage ?? null,
          payload.conversationUsage ?? null,
        );
      } else if (eventName === "error") {
        handlers.onError(payload.message);
      }
    },
    signal,
  );
}
