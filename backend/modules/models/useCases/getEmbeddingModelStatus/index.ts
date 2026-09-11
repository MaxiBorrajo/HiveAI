import { ResponseBuilder } from "../../../../core/api/response.ts";
import {
  EMBEDDING_MODEL,
  isEmbeddingModelAvailable,
} from "../../../../core/memory/embeddings.ts";

export async function getEmbeddingModelStatus(
  headers: Record<string, string>,
): Promise<Response> {
  const available = await isEmbeddingModelAvailable();
  return ResponseBuilder.success(
    { available, model: EMBEDDING_MODEL },
    { headers },
  );
}
