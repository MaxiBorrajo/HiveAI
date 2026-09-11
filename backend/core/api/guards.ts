import type { HiveMicrokernel } from "../microkernel/hive-microkernel.ts";
import { ResponseBuilder } from "./response.ts";
import { EMBEDDING_MODEL, isEmbeddingModelAvailable } from "../memory/embeddings.ts";

export function requireModelsConfigured(
  hive: HiveMicrokernel,
  headers: Record<string, string>,
): Response | null {
  const config = hive.getConfig();

  if (!config.get("model") || !config.get("selectorModel")) {
    return ResponseBuilder.error(
      [
        "No model is configured. Select a model and a selector model before continuing.",
      ],
      undefined,
      { headers, status: 400 },
    );
  }

  return null;
}

export async function requireEmbeddingModelAvailable(
  headers: Record<string, string>,
): Promise<Response | null> {
  const available = await isEmbeddingModelAvailable();

  if (!available) {
    return ResponseBuilder.error(
      [
        `Embedding model '${EMBEDDING_MODEL}' is not installed. Run 'ollama pull ${EMBEDDING_MODEL}' before sending messages.`,
      ],
      undefined,
      { headers, status: 400 },
    );
  }

  return null;
}
