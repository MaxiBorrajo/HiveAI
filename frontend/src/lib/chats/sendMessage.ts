import axios from "axios";
import { API_URL } from "../config";
import type { ChatStep } from "@/types/chat";

export interface StreamHandlers {
  onThinking: () => void;
  onThinkingDelta: (content: string) => void;
  onToken: (content: string) => void;
  onDone: (content: string, usedTools: string[], steps: ChatStep[]) => void;
  onError: (message: string) => void;
}

// Parses the backend's SSE stream (event: <name>\ndata: <json>\n\n blocks) as
// it arrives, instead of waiting for response.json(). fetch's ReadableStream
// gives us raw bytes in arbitrary chunk boundaries, so events are buffered
// until a full "\n\n"-terminated block is available.
export async function sendMessage(
  content: string,
  handlers: StreamHandlers,
): Promise<void> {
  const response = await axios.post(
    `${API_URL}/api/chats`,
    { message: content },
    {
      responseType: "stream",
      adapter: "fetch",
    },
  );

  if (!response.data) {
    throw new Error(`The backend responded with no body`);
  }

  const reader = response.data.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let separatorIndex: number;
    while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      const eventMatch = rawEvent.match(/^event: (.+)$/m);
      const dataMatch = rawEvent.match(/^data: (.+)$/m);
      if (!eventMatch || !dataMatch) continue;

      const eventName = eventMatch[1];
      const payload = JSON.parse(dataMatch[1]);

      if (eventName === "thinking") {
        handlers.onThinking();
      } else if (eventName === "thinking_delta") {
        handlers.onThinkingDelta(payload.content);
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
    }
  }
}
