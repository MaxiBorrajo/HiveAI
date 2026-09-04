import { AsyncLocalStorage } from "node:async_hooks";

// Lets a plugin report sub-steps of its own work (e.g. "trying provider X",
// "retrying") that show up alongside the Selector/Executor/HiveQueen steps in
// the chat UI, without the plugin knowing anything about LangGraph or the
// chat state. AsyncLocalStorage keeps each tool.invoke() call's reports
// isolated even if multiple tool calls ever run concurrently — a plain
// module-level array would mix reports from different plugins together.

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
