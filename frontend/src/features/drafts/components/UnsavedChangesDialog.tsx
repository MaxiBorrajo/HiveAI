import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface UnsavedChangesDialogProps {
  open: boolean;
  isSaving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
}

/** Asked when leaving edit mode (or the editor) with changes that were not saved. */
export function UnsavedChangesDialog({
  open,
  isSaving,
  onSave,
  onDiscard,
  onKeepEditing,
}: UnsavedChangesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onKeepEditing()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>You have unsaved changes</DialogTitle>
          <DialogDescription>
            Save them before leaving, or discard them and go back to the last
            saved version.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onKeepEditing} disabled={isSaving}>
            Keep editing
          </Button>
          <Button variant="secondary" onClick={onDiscard} disabled={isSaving}>
            Discard
          </Button>
          <Button onClick={onSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save and leave"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
