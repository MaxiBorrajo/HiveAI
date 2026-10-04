import { AlertCircle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { GraphViolation } from "../../types";
import type { SaveStatus } from "../../hooks/useGraphEditor";

interface ValidateGraphModalProps {
  status: SaveStatus;
  violations: GraphViolation[];
  errors: string[];
  onClose: () => void;
  onSelectNode: (nodeId: string) => void;
}

export function ValidateGraphModal({
  status,
  violations,
  errors,
  onClose,
  onSelectNode,
}: ValidateGraphModalProps) {
  const groups = new Map<string, { name: string; items: GraphViolation[] }>();
  for (const violation of violations) {
    const id = violation.nodeId || "";
    const group = groups.get(id) ?? { name: violation.nodeName, items: [] };
    group.items.push(violation);
    groups.set(id, group);
  }

  return (
    <Dialog open={status !== "idle"} onOpenChange={(open) => !open && status === "failed" && onClose()}>
      <DialogContent>
        {status === "verifying" ? (
          <>
            <DialogHeader>
              <DialogTitle>Verifying graph…</DialogTitle>
            </DialogHeader>
            <div className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Checking the workflow structure, variables and plugins.
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertCircle className="size-4 text-destructive" />
                The graph has {violations.length || errors.length} error
                {(violations.length || errors.length) === 1 ? "" : "s"}
              </DialogTitle>
            </DialogHeader>
            <div className="max-h-[50vh] space-y-3 overflow-auto py-2">
              {violations.length === 0
                ? errors.map((error, i) => (
                    <p key={i} className="text-sm text-destructive">{error}</p>
                  ))
                : [...groups.entries()].map(([nodeId, group]) => (
                    <div key={nodeId || "graph"} className="rounded-lg border border-border bg-muted/50 p-3">
                      <button
                        type="button"
                        disabled={!nodeId}
                        onClick={() => {
                          onSelectNode(nodeId);
                          onClose();
                        }}
                        className="mb-1.5 text-xs font-medium text-foreground enabled:hover:underline"
                      >
                        {nodeId ? group.name : "Graph"}
                      </button>
                      <ul className="space-y-1">
                        {group.items.map((item, i) => (
                          <li key={i} className="text-xs leading-relaxed text-destructive">
                            {item.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
            </div>
            <DialogFooter>
              <Button onClick={onClose}>Back to editing</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
