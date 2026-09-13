import { AsyncLocalStorage } from "node:async_hooks";

export interface PluginStepReport {
  label: string;
  reportedAt: number;
}

const MAX_LABEL_CHARS = 200;

const storage = new AsyncLocalStorage<{
  callId: string;
  buffer: PluginStepReport[];
}>();

const activeCallBuffers = new Map<string, PluginStepReport[]>();

function truncate(label: string): string {
  const oneLine = label.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_LABEL_CHARS
    ? `${oneLine.slice(0, MAX_LABEL_CHARS)}...`
    : oneLine;
}

export function reportPluginStep(label: string): void {
  storage
    .getStore()
    ?.buffer.push({ label: truncate(label), reportedAt: Date.now() });
}

export function getCurrentCallId(): string | undefined {
  return storage.getStore()?.callId;
}

export function reportPluginStepForCall(
  callId: string,
  label: string,
): boolean {
  const buffer = activeCallBuffers.get(callId);
  if (!buffer) return false;
  buffer.push({ label: truncate(label), reportedAt: Date.now() });
  return true;
}

export async function captureSteps<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; steps: PluginStepReport[] }> {
  const callId = crypto.randomUUID();
  const buffer: PluginStepReport[] = [];
  activeCallBuffers.set(callId, buffer);

  try {
    const result = await storage.run({ callId, buffer }, fn);
    return { result, steps: buffer };
  } finally {
    activeCallBuffers.delete(callId);
  }
}
