import { Ollama } from "ollama";
import { OllamaEmbeddings } from "@langchain/ollama";

export const EMBEDDING_MODEL = "nomic-embed-text";
export const EMBEDDING_DIMENSIONS = 768;

let readyPromise: Promise<void> | null = null;

export async function ensureEmbeddingModelReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = provisionEmbeddingModel().catch((error) => {
      readyPromise = null;
      throw error;
    });
  }
  return readyPromise;
}

async function provisionEmbeddingModel(): Promise<void> {
  const ollama = new Ollama();

  const { models } = await ollama.list();
  const isDownloaded = models.some((m) => m.name.startsWith(EMBEDDING_MODEL));

  if (isDownloaded) return;

  console.log(`[Memory] Pulling embedding model '${EMBEDDING_MODEL}'...`);
  await ollama.pull({ model: EMBEDDING_MODEL });
  console.log(`[Memory] Embedding model '${EMBEDDING_MODEL}' ready.`);
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
