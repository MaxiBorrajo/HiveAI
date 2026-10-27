import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  getModelImpact,
  type ModelImpact,
} from "@/features/models/api/downloads";
import { formatBytes } from "@/features/models/lib/formatBytes";

interface DeleteModelDialogProps {
  name: string | null;
  onClose: () => void;
  onConfirm: (name: string) => void;
}

export function DeleteModelDialog({
  name,
  onClose,
  onConfirm,
}: DeleteModelDialogProps) {
  const [impact, setImpact] = useState<ModelImpact | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setImpact(null);
    setFailed(false);
    if (!name) return;
    let cancelled = false;
    getModelImpact(name)
      .then((i) => !cancelled && setImpact(i))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [name]);

  const used = impact
    ? impact.usage.chat || impact.usage.executions.length > 0
    : false;

  return (
    <Dialog open={!!name} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete '{name}'?</DialogTitle>
          <DialogDescription>
            {impact
              ? `This frees ${formatBytes(impact.freedBytes)} of disk space. You can download it again later.`
              : failed
                ? "Could not check where this model is used."
                : "Checking where this model is used…"}
          </DialogDescription>
        </DialogHeader>

        {impact?.inUseNow && (
          <p className="text-sm text-destructive">
            This model is being used right now by a chat or an execution. Wait
            for it to finish to delete it.
          </p>
        )}

        {used && impact && (
          <div className="flex flex-col gap-1 text-sm">
            <p>These items use this model and will be left without it:</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {impact.usage.chat && <li>Chat (current model)</li>}
              {impact.usage.executions.map((e) => (
                <li key={e.id}>
                  Strategy “{e.name}” ({e.nodeIds.length}{" "}
                  {e.nodeIds.length === 1 ? "node" : "nodes"})
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              They are not modified. When you use them you will be asked to
              pick another model or download this one again.
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!name || !impact || impact.inUseNow || impact.isEmbeddingModel}
            onClick={() => {
              if (name) onConfirm(name);
              onClose();
            }}
          >
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
