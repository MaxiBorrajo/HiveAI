import { postSse } from "../sse";

export interface PullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}

export interface PullEmbeddingModelHandlers {
  onProgress: (progress: PullProgress) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

export async function pullEmbeddingModel(
  handlers: PullEmbeddingModelHandlers,
): Promise<void> {
  await postSse("/api/models/embedding-model/pull", undefined, (eventName, payload) => {
    if (eventName === "progress") {
      handlers.onProgress(payload);
    } else if (eventName === "done") {
      handlers.onDone();
    } else if (eventName === "error") {
      handlers.onError(payload.message);
    }
  });
}
