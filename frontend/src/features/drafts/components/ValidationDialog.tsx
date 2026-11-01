import { Copy, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { copyToClipboard } from "@/lib/errorDetails";
import { reportSuccess } from "@/lib/toastManager";

interface ValidationDialogProps {
  open: boolean;
  issues: string[];
  /** Why the dialog was opened, e.g. "saved with errors" or "cannot be published yet". */
  context: "save" | "publish";
  onFixWithAi: () => void;
  onClose: () => void;
}

/** Same idea as the flow validation modal: list the errors and offer to fix them with the AI. */
export function ValidationDialog({
  open,
  issues,
  context,
  onFixWithAi,
  onClose,
}: ValidationDialogProps) {
  async function handleCopy() {
    if (await copyToClipboard(issues.join("\n\n"))) {
      reportSuccess("Issues copied");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            The plugin has {issues.length} issue{issues.length === 1 ? "" : "s"}
          </DialogTitle>
          <DialogDescription>
            {context === "publish"
              ? "It can't be published until these are fixed."
              : "Your changes were saved, but the plugin doesn't pass validation yet."}
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-[50vh] list-disc space-y-2 overflow-auto pl-5 text-xs wrap-break-word text-destructive select-text">
          {issues.map((issue, i) => (
            <li key={i} className="whitespace-pre-wrap font-mono">
              {issue}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" className="gap-1.5" onClick={handleCopy}>
            <Copy className="size-3.5" /> Copy
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Keep editing
          </Button>
          <Button className="gap-1.5" onClick={onFixWithAi}>
            <Sparkles className="size-3.5" /> Fix with AI
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
