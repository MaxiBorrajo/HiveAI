import { Ollama, type ProgressResponse } from "ollama";
import { OllamaEmbeddings } from "@langchain/ollama";

export const EMBEDDING_MODEL = "nomic-embed-text";
export const EMBEDDING_DIMENSIONS = 768;

export async function isEmbeddingModelAvailable(): Promise<boolean> {
  const ollama = new Ollama();
  const { models } = await ollama.list();
  return models.some((m) => m.name.startsWith(EMBEDDING_MODEL));
}

export async function* pullEmbeddingModel(): AsyncGenerator<ProgressResponse> {
  const ollama = new Ollama();
  const stream = await ollama.pull({ model: EMBEDDING_MODEL, stream: true });

  for await (const progress of stream) {
    yield progress;
  }
}

export async function ensureEmbeddingModelReady(): Promise<void> {
  const available = await isEmbeddingModelAvailable();
  if (!available) {
    throw new Error(
      `Embedding model '${EMBEDDING_MODEL}' is not installed. Run 'ollama pull ${EMBEDDING_MODEL}' to enable conversation memory.`,
    );
  }
}

let embedder: OllamaEmbeddings | null = null;

function getEmbedder(): OllamaEmbeddings {
  if (!embedder) {
    embedder = new OllamaEmbeddings({ model: EMBEDDING_MODEL });
  }
  return embedder;
}

export async function embedText(text: string): Promise<number[]> {
  await ensureEmbeddingModelReady();
  return getEmbedder().embedQuery(text);
}
