import { Ollama } from "ollama";

const POLL_INTERVAL_MS = 1000;

export async function isModelLoaded(model: string): Promise<boolean | null> {
  try {
    const { models } = await new Ollama().ps();
    return models.some((m) => m.name === model || m.model === model);
  } catch {
    return null;
  }
}

export type ModelLoadPhase = "loading_model" | "processing";

export async function watchModelLoad(
  model: string,
  onPhase: (phase: ModelLoadPhase) => void,
): Promise<() => void> {
  let stopped = false;
  const stop = () => {
    stopped = true;
  };

  if ((await isModelLoaded(model)) !== false) return stop;

  onPhase("loading_model");
  (async () => {
    while (!stopped) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      if (stopped) return;
      if ((await isModelLoaded(model)) !== false) break;
    }
    if (!stopped) onPhase("processing");
  })();

  return stop;
}
