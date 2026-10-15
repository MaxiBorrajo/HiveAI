import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ClarifyPanel } from "./ClarifyPanel.tsx";
import {
  listPendingInteractions,
  resolveInteraction,
  resolveClarification,
  type PendingInteraction,
} from "@/features/interactions";

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
          const list = data ?? [];
          setPending((current) =>
            current
              ? (list.find((item) => item.id === current.id) ?? list[0] ?? null)
              : (list[0] ?? null),
          );
        }
      } catch {}
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

  async function submitAnswer(value: string) {
    if (!pending || !value.trim()) return;
    setIsResolving(true);
    try {
      await resolveClarification(pending.id, value.trim());
    } finally {
      setPending(null);
      setIsResolving(false);
    }
  }

  const payload = pending?.payload;

  if (payload?.kind === "clarify") {
    return (
      <ClarifyPanel
        key={pending!.id}
        question={payload.question}
        options={payload.options}
        isResolving={isResolving}
        onSubmit={submitAnswer}
      />
    );
  }

  if (!pending || payload?.kind !== "approval") return null;

  return (
    <div className="w-full rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-sm">
      <p className="text-sm font-medium">{payload.title}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {payload.description}
      </p>

      {payload.details && (
        <div className="mt-2 min-w-0 space-y-2">
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

      <div className="mt-3 flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={isResolving}
          onClick={() => handleDecision("reject")}
        >
          Rechazar
        </Button>
        <Button
          size="sm"
          disabled={isResolving}
          onClick={() => handleDecision("approve")}
        >
          Aprobar
        </Button>
      </div>
    </div>
  );
}
