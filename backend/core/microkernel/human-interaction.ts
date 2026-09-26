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

const INTERACTION_TIMEOUT_MS = 2 * 60 * 1000;

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
    const id = crypto.randomUUID();

    const wait = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(false);
      }, INTERACTION_TIMEOUT_MS);

      this.pending.set(id, {
        id,
        pluginName,
        payload,
        requestedAt: Date.now(),
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result.kind === "approval" ? result.approved : false);
        },
      });
    });

    return { id, wait };
  }

  requestClarification(
    pluginName: string,
    payload: ClarifyPayload,
  ): { id: string; wait: Promise<string> } {
    const id = crypto.randomUUID();

    const wait = new Promise<string>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve("");
      }, INTERACTION_TIMEOUT_MS);

      this.pending.set(id, {
        id,
        pluginName,
        payload,
        requestedAt: Date.now(),
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result.kind === "clarify" ? result.answer : "");
        },
      });
    });

    return { id, wait };
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
