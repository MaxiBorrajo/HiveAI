export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (eventName: string, payload: any) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  if (signal) {
    signal.addEventListener("abort", () => {
      reader.cancel().catch(() => {});
    });
  }

  while (true) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
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

      onEvent(eventMatch[1], JSON.parse(dataMatch[1]));
    }
  }

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}
