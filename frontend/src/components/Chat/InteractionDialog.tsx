import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { listPendingInteractions } from "../../lib/api/interactions/list-pending-interactions.ts";
import { resolveInteraction } from "../../lib/api/interactions/resolve-interaction.ts";
import type { PendingInteraction } from "@/types/interaction";

const POLL_INTERVAL_MS = 1500;

// Generic across any plugin that needs a human to approve something before it
// proceeds — not just run_shell. Polls for pending interactions and renders
// UI based on each entry's payload.kind, so a future "choice"/"input" kind
// only needs a new branch here, not a new dialog + polling loop.
export function InteractionDialog() {
  const [pending, setPending] = useState<PendingInteraction | null>(null);
  const [isResolving, setIsResolving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const interactions = await listPendingInteractions();
        if (!cancelled) {
          setPending((current) => current ?? interactions[0] ?? null);
        }
      } catch {
        // Backend unreachable; try again on the next tick.
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function handleDecision(decision: "approve" | "reject") {
    if (!pending) return;
    setIsResolving(true);
    try {
      await resolveInteraction(pending.id, decision);
    } finally {
      setPending(null);
      setIsResolving(false);
    }
  }

  if (pending && pending.payload.kind !== "approval") {
    // Unknown/unsupported kind: don't block the user on a dialog we can't
    // render meaningfully for.
    return null;
  }

  const payload = pending?.payload;

  return (
    <Dialog open={pending != null}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{payload?.title}</DialogTitle>
          <DialogDescription>{payload?.description}</DialogDescription>
        </DialogHeader>

        {payload?.details && (
          <div className="space-y-2">
            {Object.entries(payload.details).map(([key, value]) => (
              <div key={key}>
                {key === "command" ? (
                  <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                    {value}
                  </pre>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {key}: {value}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={isResolving}
            onClick={() => handleDecision("reject")}
          >
            Rechazar
          </Button>
          <Button
            disabled={isResolving}
            onClick={() => handleDecision("approve")}
          >
            Aprobar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
