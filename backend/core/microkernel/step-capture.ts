import { AsyncLocalStorage } from "node:async_hooks";

export interface PluginStepReport {
  label: string;
  reportedAt: number;
}

const MAX_LABEL_CHARS = 200;

const storage = new AsyncLocalStorage<PluginStepReport[]>();

export function reportPluginStep(label: string): void {
  const oneLine = label.replace(/\s+/g, " ").trim();
  const truncated = oneLine.length > MAX_LABEL_CHARS
    ? `${oneLine.slice(0, MAX_LABEL_CHARS)}...`
    : oneLine;
  storage.getStore()?.push({ label: truncated, reportedAt: Date.now() });
}

export async function captureSteps<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; steps: PluginStepReport[] }> {
  const buffer: PluginStepReport[] = [];
  const result = await storage.run(buffer, fn);
  return { result, steps: buffer };
}
