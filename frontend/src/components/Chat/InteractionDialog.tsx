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
import { Textarea } from "@/components/ui/textarea";
import {
  listPendingInteractions,
  resolveInteraction,
  resolveClarification,
  type PendingInteraction,
} from "@/lib/interactions";

const POLL_INTERVAL_MS = 1500;

export function InteractionDialog() {
  const [pending, setPending] = useState<PendingInteraction | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [answer, setAnswer] = useState("");
  const [showOtherInput, setShowOtherInput] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const { data } = await listPendingInteractions();
        if (!cancelled) {
          setPending((current) => current ?? data?.[0] ?? null);
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
      setAnswer("");
      setShowOtherInput(false);
      setIsResolving(false);
    }
  }

  const payload = pending?.payload;

  if (payload?.kind === "clarify") {
    const hasOptions = !!payload.options?.length;
    const showTextarea = !hasOptions || showOtherInput;

    return (
      <Dialog open={pending != null}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>The agent needs more information</DialogTitle>
            <DialogDescription>{payload.question}</DialogDescription>
          </DialogHeader>

          {hasOptions && !showOtherInput && (
            <div className="flex flex-col gap-1.5">
              {payload.options!.map((option) => (
                <Button
                  key={option}
                  variant="outline"
                  disabled={isResolving}
                  className="justify-start text-left h-auto py-2 whitespace-normal"
                  onClick={() => submitAnswer(option)}
                >
                  {option}
                </Button>
              ))}
              <Button
                variant="ghost"
                disabled={isResolving}
                className="justify-start text-muted-foreground"
                onClick={() => setShowOtherInput(true)}
              >
                Other…
              </Button>
            </div>
          )}

          {showTextarea && (
            <Textarea
              autoFocus
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submitAnswer(answer);
                }
              }}
              placeholder="Type your answer..."
              className="min-h-20"
            />
          )}

          {showTextarea && (
            <DialogFooter>
              <Button
                disabled={isResolving || !answer.trim()}
                onClick={() => submitAnswer(answer)}
              >
                Send
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  if (pending && payload?.kind !== "approval") {
    return null;
  }

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
