import { AsyncLocalStorage } from "node:async_hooks";

export interface ApprovalPayload {
  kind: "approval";
  title: string;
  description: string;
  details?: Record<string, string>;
}

export interface ClarifyPayload {
  kind: "clarify";
  question: string;
  options?: string[];
}

export type InteractionPayload = ApprovalPayload | ClarifyPayload;

export interface PendingInteraction {
  id: string;
  pluginName: string;
  requestedAt: number;
  payload: InteractionPayload;
}

export type InteractionResult =
  | { kind: "approval"; approved: boolean }
  | { kind: "clarify"; answer: string };

interface PendingEntry extends PendingInteraction {
  resolve: (result: InteractionResult) => void;
}

export const executionContextStorage = new AsyncLocalStorage<{
  autoApprove: boolean;
  signal?: AbortSignal;
  interactive?: boolean;
}>();

class HumanInteractionQueue {
  private pending = new Map<string, PendingEntry>();

  list(): PendingInteraction[] {
    return Array.from(this.pending.values()).map(
      ({ resolve: _resolve, ...rest }) => rest,
    );
  }

  requestApproval(
    pluginName: string,
    payload: ApprovalPayload,
  ): { id: string; wait: Promise<boolean> } {
    const execContext = executionContextStorage.getStore();
    if (execContext?.autoApprove) {
      console.log(
        `[human-interaction] ⚡ Execution workflow context active. Auto-approving request for '${pluginName}'.`,
      );
      return { id: "auto-approved", wait: Promise.resolve(true) };
    }

    const id = crypto.randomUUID();
    const signal = execContext?.signal;

    const wait = new Promise<boolean>((resolve) => {
      this.enqueue(id, pluginName, payload, signal, (result) =>
        resolve(result?.kind === "approval" ? result.approved : false),
      );
    });

    return { id, wait };
  }

  requestClarification(
    pluginName: string,
    payload: ClarifyPayload,
  ): { id: string; wait: Promise<string> } {
    const id = crypto.randomUUID();
    const signal = executionContextStorage.getStore()?.signal;

    const wait = new Promise<string>((resolve) => {
      this.enqueue(id, pluginName, payload, signal, (result) =>
        resolve(result?.kind === "clarify" ? result.answer : ""),
      );
    });

    return { id, wait };
  }

  private enqueue(
    id: string,
    pluginName: string,
    payload: InteractionPayload,
    signal: AbortSignal | undefined,
    settle: (result: InteractionResult | null) => void,
  ): void {
    const onAbort = () => {
      this.pending.delete(id);
      settle(null);
    };

    if (signal?.aborted) {
      settle(null);
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    this.pending.set(id, {
      id,
      pluginName,
      payload,
      requestedAt: Date.now(),
      resolve: (result) => {
        signal?.removeEventListener("abort", onAbort);
        settle(result);
      },
    });
  }

  resolve(id: string, result: InteractionResult): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;

    this.pending.delete(id);
    entry.resolve(result);
    return true;
  }
}

export const humanInteractionQueue = new HumanInteractionQueue();
