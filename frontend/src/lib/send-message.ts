import type { ChatStep } from "@/types/chat";

interface StreamHandlers {
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
  const response = await fetch("http://localhost:8000/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: content }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`El backend respondió con estado ${response.status}`);
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
        handlers.onDone(payload.content, payload.usedTools ?? [], payload.steps ?? []);
      } else if (eventName === "error") {
        handlers.onError(payload.message);
      }
    }
  }
}
