/**
 * Endpoint: POST /api/chat
 * Descripción: Envía un mensaje al backend y procesa la respuesta en streaming (SSE), gestionando tokens de texto y estado de pensamiento del bot.
 */
import { API_URL } from "@/lib/config";
import type { ChatStep } from "@/types/chat";

interface StreamHandlers {
  onThinking: () => void;
  onThinkingDelta: (content: string) => void;
  onToken: (content: string) => void;
  onDone: (content: string, usedTools: string[], steps: ChatStep[]) => void;
  onError: (message: string) => void;
}

export async function sendMessage(
  content: string,
  handlers: StreamHandlers,
): Promise<void> {
  const response = await fetch(`${API_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: content }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`The backend responded with status ${response.status}`);
  }

  const reader = response.body.getReader();
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
