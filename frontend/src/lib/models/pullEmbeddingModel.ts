import { apiClient } from "../apiClient";
import { readSseStream } from "../sse";

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
  const response = await apiClient.post(
    "/api/models/embedding-model/pull",
    undefined,
    {
      responseType: "stream",
      adapter: "fetch",
    },
  );

  if (!response.data) {
    throw new Error("The backend responded with no body");
  }

  await readSseStream(response.data, (eventName, payload) => {
    if (eventName === "progress") {
      handlers.onProgress(payload);
    } else if (eventName === "done") {
      handlers.onDone();
    } else if (eventName === "error") {
      handlers.onError(payload.message);
    }
  });
}
