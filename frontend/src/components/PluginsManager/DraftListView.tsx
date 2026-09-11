import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, FilePenLine } from "lucide-react";
import { listDrafts, createDraft, removeDraft, type Draft } from "@/lib/get-drafts";

interface DraftListViewProps {
  onOpenDraft: (name: string) => void;
}

export function DraftListView({ onOpenDraft }: DraftListViewProps) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    listDrafts().then(setDrafts);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    try {
      const draft = await createDraft(name);
      setNewName("");
      setIsCreating(false);
      refresh();
      onOpenDraft(draft.name);
      toast.success(`Draft '${draft.name}' created.`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not create the draft.";
      setError(message);
      toast.error(message);
    }
  }

  async function handleRemove(name: string) {
    try {
      await removeDraft(name);
      refresh();
      toast.success(`Draft '${name}' deleted.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete the draft.");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Drafts</p>
        {isCreating ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") setIsCreating(false);
              }}
              placeholder="plugin-name"
              className="h-8 rounded-md border border-border bg-background px-2 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <Button size="sm" className="h-8" onClick={handleCreate}>
              Create
            </Button>
          </div>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            className="gap-1.5"
            onClick={() => setIsCreating(true)}
          >
            <Plus size={14} /> New Plugin
          </Button>
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {drafts.length === 0 && !isCreating && (
        <p className="text-sm text-muted-foreground">
          No drafts yet. Start a new plugin to scaffold one.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {drafts.map((draft) => (
          <div
            key={draft.name}
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
          >
            <span className="font-mono text-sm">{draft.name}</span>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="h-8 gap-1 px-3"
                onClick={() => onOpenDraft(draft.name)}
              >
                <FilePenLine size={12} /> Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1 px-3 text-destructive hover:text-destructive"
                onClick={() => handleRemove(draft.name)}
              >
                <Trash2 size={12} />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
