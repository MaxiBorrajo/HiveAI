import { pullEmbeddingModel } from "../../../core/memory/embeddings.ts";
import { createSseResponse } from "../../../core/api/sse.ts";

export function handlePullEmbeddingModel(
  headers: Record<string, string>,
): Response {
  return createSseResponse(headers, async (send) => {
    for await (const progress of pullEmbeddingModel()) {
      send("progress", progress);
    }
    send("done", {});
  });
}
