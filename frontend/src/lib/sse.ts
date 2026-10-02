import { apiClient } from "./apiClient";

export type SseEventHandler = (eventName: string, payload: any) => void;

function parseFrame(frame: string): { event: string; data: string } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  return dataLines.length > 0 ? { event, data: dataLines.join("\n") } : null;
}

export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: SseEventHandler,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", onAbort);

  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      let separatorIndex: number;
      while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
        const frame = parseFrame(buffer.slice(0, separatorIndex));
        buffer = buffer.slice(separatorIndex + 2);
        if (!frame) continue;

        let payload: unknown;
        try {
          payload = JSON.parse(frame.data);
        } catch {
          console.warn("Skipping malformed SSE frame:", frame.data);
          continue;
        }
        onEvent(frame.event, payload);
      }
    }

    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function postSse(
  url: string,
  body: unknown,
  onEvent: SseEventHandler,
  signal?: AbortSignal,
): Promise<void> {
  const response = await apiClient.post(url, body, {
    responseType: "stream",
    adapter: "fetch",
    signal,
  });

  if (!response.data) {
    throw new Error("The backend responded with no body");
  }

  await readSseStream(response.data, onEvent, signal);
}
