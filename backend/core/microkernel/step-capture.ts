import { AsyncLocalStorage } from "node:async_hooks";

// Lets a plugin report sub-steps of its own work (e.g. "trying provider X",
// "retrying") that show up alongside the Selector/Executor/HiveQueen steps in
// the chat UI, without the plugin knowing anything about LangGraph or the
// chat state.
//
// Two delivery paths exist, because a plugin's code can run in two different
// places:
//
// 1. In-process plugins (built-in, imported at build time) call
//    reportPluginStep() directly, and AsyncLocalStorage keeps each
//    tool.invoke() call's reports isolated even under concurrency — a plain
//    module-level array would mix reports from different plugins together.
//
// 2. External plugins (see core/microkernel/external-plugins/) run in a
//    separate subprocess and proxy reportStep() back to this process over
//    HTTP. AsyncLocalStorage does NOT survive that trip — verified: a new
//    inbound HTTP request is a fresh async context, unrelated to whichever
//    captureSteps() call is waiting on the outbound fetch that triggered it.
//    So the flow for external plugins is: HiveMicrokernel.execute() reads
//    getCurrentCallId() (still inside the original AsyncLocalStorage
//    context, since that call is synchronous/local) and hands it to the
//    plugin's process() call; the external-plugin-host sends it in the
//    /process request body; the subprocess echoes it back on every
//    reportStep/requestApproval callback; the HTTP handler for those
//    callbacks appends to that specific call's buffer via
//    reportPluginStepForCall(callId, label).

export interface PluginStepReport {
  label: string;
  reportedAt: number;
}

const MAX_LABEL_CHARS = 200;

const storage = new AsyncLocalStorage<{ callId: string; buffer: PluginStepReport[] }>();

// Buffers for calls currently in flight, keyed by callId. Populated for the
// whole lifetime of a captureSteps() call (not just while inside the
// AsyncLocalStorage-run callback), so the external-plugin-callbacks HTTP
// handler can append to it at any point during that call.
const activeCallBuffers = new Map<string, PluginStepReport[]>();

function truncate(label: string): string {
  const oneLine = label.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_LABEL_CHARS
    ? `${oneLine.slice(0, MAX_LABEL_CHARS)}...`
    : oneLine;
}

export function reportPluginStep(label: string): void {
  storage.getStore()?.buffer.push({ label: truncate(label), reportedAt: Date.now() });
}

// Read from inside HiveMicrokernel.execute() (still within the same
// synchronous/local async chain captureSteps() opened) to get an ID that can
// be handed to an external plugin's subprocess, so it can correlate its
// out-of-band HTTP callbacks back to this specific invocation.
export function getCurrentCallId(): string | undefined {
  return storage.getStore()?.callId;
}

// Used by the external-plugin-callbacks HTTP handler — the plugin subprocess
// sends back the callId it was invoked with (obtained via getCurrentCallId()
// and passed through /process), and this appends to that call's buffer.
export function reportPluginStepForCall(callId: string, label: string): boolean {
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
