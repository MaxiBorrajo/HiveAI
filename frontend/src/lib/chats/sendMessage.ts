import { apiClient } from "../apiClient";
import { readSseStream } from "../sse";
import type { ChatStep } from "@/types/chat";

export interface StreamHandlers {
  onChatCreated: (chatId: string) => void;
  onThinking: () => void;
  onThinkingDelta: (content: string, node: string | undefined) => void;
  onToken: (content: string) => void;
  onDone: (content: string, usedTools: string[], steps: ChatStep[]) => void;
  onError: (message: string) => void;
}

export async function sendMessage(
  chatId: string | null,
  content: string,
  handlers: StreamHandlers,
): Promise<void> {
  const response = await apiClient.post(
    "/api/chats",
    { chatId: chatId ?? undefined, message: content },
    {
      responseType: "stream",
      adapter: "fetch",
    },
  );

  if (!response.data) {
    throw new Error(`The backend responded with no body`);
  }

  await readSseStream(response.data, (eventName, payload) => {
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
      );
    } else if (eventName === "error") {
      handlers.onError(payload.message);
    }
  });
}
