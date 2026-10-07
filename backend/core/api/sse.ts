export type SseSend = (event: string, data: unknown) => void;

export function createSseResponse(
  headers: Record<string, string>,
  run: (send: SseSend) => Promise<void>,
): Response {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send: SseSend = (event, data) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        await run(send);
      } catch (error) {
        if ((error as Error)?.name !== "AbortError") {
          console.error("[SSE] Error while streaming:", error);
        }
        const detail = error instanceof Error ? error.message : String(error);
        try {
          send("error", { message: detail });
        } catch {
          // stream already closed by the client
        }
      } finally {
        try {
          controller.close();
        } catch {
          // stream already closed or cancelled
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...headers,
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
