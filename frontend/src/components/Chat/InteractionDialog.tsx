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
import {
  listPendingInteractions,
  resolveInteraction,
  type PendingInteraction,
} from "@/lib/interactions";

const POLL_INTERVAL_MS = 1500;

export function InteractionDialog() {
  const [pending, setPending] = useState<PendingInteraction | null>(null);
  const [isResolving, setIsResolving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const { data } = await listPendingInteractions();
        if (!cancelled) {
          setPending((current) => current ?? data?.[0] ?? null);
        }
      } catch {
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
          <div className="min-w-0 space-y-2">
            {Object.entries(payload.details).map(([key, value]) => (
              <div key={key} className="min-w-0">
                {key === "command" ? (
                  <pre className="max-h-40 min-w-0 overflow-y-auto whitespace-pre-wrap wrap-break-word rounded-md bg-muted p-3 font-mono text-xs">
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
