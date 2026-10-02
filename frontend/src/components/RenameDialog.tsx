import { useState, useEffect } from "react";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";

export interface RenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTitle?: string;
  entityName: string;
  onConfirm: (newTitle: string) => void | Promise<void>;
}

export function RenameDialog({
  open,
  onOpenChange,
  initialTitle = "",
  entityName,
  onConfirm,
}: RenameDialogProps) {
  const [title, setTitle] = useState(initialTitle);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(initialTitle || "");
    }
  }, [open, initialTitle]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || isSaving) return;

    try {
      setIsSaving(true);
      await onConfirm(trimmed);
      onOpenChange(false);
    } catch (err) {
      console.error(`Failed to rename ${entityName}:`, err);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Rename {entityName}</DialogTitle>
            <DialogDescription>
              Enter a new name for this {entityName.toLowerCase().trim()}.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`Enter ${entityName.toLowerCase().trim()} name...`}
              autoFocus
              disabled={isSaving}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim() || isSaving}>
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

