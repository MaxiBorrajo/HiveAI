// In-memory pending-interaction queue shared between plugins and the HTTP layer
// (main.ts). Any plugin that needs a human to look at something before it
// proceeds — approve a shell command, pick among options, fill in a missing
// value — requests an interaction here and awaits the result; it never talks
// to the HTTP layer or the frontend directly. main.ts exposes a single set of
// generic endpoints to list/resolve pending interactions, and the frontend
// renders whichever UI fits the interaction's `kind`.
//
// Today only "approval" is implemented (yes/no on a piece of context), but the
// queue itself doesn't know or care what kinds exist — adding "choice" or
// "input" later means adding a new kind + payload shape, not touching this
// file, main.ts's routing, or the polling mechanism.

export interface ApprovalPayload {
  kind: "approval";
  title: string;
  description: string;
  // Freeform details shown to the user (e.g. the exact command, a diff, a
  // file path) — rendered as-is, kind-specific meaning is up to the caller.
  details?: Record<string, string>;
}

export type InteractionPayload = ApprovalPayload;

export interface PendingInteraction {
  id: string;
  pluginName: string;
  requestedAt: number;
  payload: InteractionPayload;
}

export type InteractionResult =
  | { kind: "approval"; approved: boolean };

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

  resolve(id: string, result: InteractionResult): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;

    this.pending.delete(id);
    entry.resolve(result);
    return true;
  }
}

export const humanInteractionQueue = new HumanInteractionQueue();
