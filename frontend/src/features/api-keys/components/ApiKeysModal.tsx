import { useCallback, useEffect, useState } from "react";
import { KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  createApiKey,
  deleteApiKey,
  getApiKeyUsage,
  listApiKeys,
  updateApiKey,
} from "../api/apiKeys";
import {
  CLOUD_PROVIDERS,
  PROVIDER_LABELS,
  type ApiKey,
  type ApiKeyUsage,
  type CloudProvider,
} from "../types";

interface ApiKeysModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after any change so model lists can refresh. */
  onChanged?: () => void;
}

type Editing =
  | { mode: "create" }
  | { mode: "edit"; key: ApiKey }
  | null;

function errorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { errors?: string[] } } })
    ?.response?.data;
  return data?.errors?.[0] ?? (error as Error)?.message ?? "Something went wrong";
}

function usageSummary(usage: ApiKeyUsage): string {
  const parts: string[] = [];
  if (usage.chat) parts.push("the chat model");
  for (const e of usage.executions) {
    parts.push(`"${e.name}" (${e.nodeIds.length} node${e.nodeIds.length > 1 ? "s" : ""})`);
  }
  return parts.join(", ");
}

function KeyForm({
  editing,
  onCancel,
  onSaved,
}: {
  editing: Exclude<Editing, null>;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const existing = editing.mode === "edit" ? editing.key : undefined;
  const [provider, setProvider] = useState<CloudProvider>(
    existing?.provider ?? "anthropic",
  );
  const [alias, setAlias] = useState(existing?.alias ?? "");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setError(null);
    setSaving(true);
    try {
      const res = existing
        ? await updateApiKey(existing.id, {
            alias: alias !== existing.alias ? alias : undefined,
            value: value || undefined,
          })
        : await createApiKey({ provider, alias, value });
      if (!res.success) {
        setError(res.errors?.[0] ?? "The key could not be saved");
        return;
      }
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const canSave = alias.trim() && (existing || value.trim());

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <p className="text-sm font-semibold">
        {existing ? `Edit "${existing.alias}"` : "Add an API key"}
      </p>
      {!existing && (
        <label className="flex flex-col gap-1 text-xs">
          Provider
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as CloudProvider)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            {CLOUD_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-xs">
        Alias
        <Input
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          placeholder="Claude – personal"
          maxLength={60}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        {existing ? "Replace key (leave empty to keep the current one)" : "API key"}
        <Input
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={existing ? existing.masked : "Paste your key"}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        The key is checked with the provider before it is saved and stored
        encrypted on this device. It is never shown again.
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={submit} disabled={!canSave || saving}>
          {saving ? "Validating..." : "Save"}
        </Button>
      </div>
    </div>
  );
}

export function ApiKeysModal({
  isOpen,
  onOpenChange,
  onChanged,
}: ApiKeysModalProps) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [editing, setEditing] = useState<Editing>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    key: ApiKey;
    usage: ApiKeyUsage;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await listApiKeys();
      setKeys(data ?? []);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      load();
    } else {
      setEditing(null);
      setPendingDelete(null);
    }
  }, [isOpen, load]);

  async function afterChange() {
    setEditing(null);
    setPendingDelete(null);
    await load();
    onChanged?.();
  }

  async function requestDelete(key: ApiKey) {
    setError(null);
    try {
      const { data: usage } = await getApiKeyUsage(key.id);
      const inUse = !!usage && (usage.chat || usage.executions.length > 0);
      if (inUse) {
        setPendingDelete({ key, usage });
      } else {
        await deleteApiKey(key.id);
        await afterChange();
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await deleteApiKey(pendingDelete.key.id, true);
      await afterChange();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[90vw] max-w-2xl sm:max-w-2xl h-[75vh] p-0 flex flex-col"
        showCloseButton
      >
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4" /> API keys
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 p-6 pt-2">
          <div className="flex flex-col gap-3">
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}

            {pendingDelete && (
              <div
                role="alertdialog"
                className="flex flex-col gap-2 rounded-lg border border-destructive/50 bg-card p-4"
              >
                <p className="text-sm font-semibold">
                  Delete "{pendingDelete.key.alias}"?
                </p>
                <p className="text-xs text-muted-foreground">
                  This key is used by {usageSummary(pendingDelete.usage)}. Those
                  models will stop working until you pick another key; past
                  results are kept.
                </p>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPendingDelete(null)}
                  >
                    Keep it
                  </Button>
                  <Button variant="destructive" size="sm" onClick={confirmDelete}>
                    Delete anyway
                  </Button>
                </div>
              </div>
            )}

            {editing ? (
              <KeyForm
                editing={editing}
                onCancel={() => setEditing(null)}
                onSaved={afterChange}
              />
            ) : (
              <Button
                variant="secondary"
                size="sm"
                className="self-start"
                onClick={() => setEditing({ mode: "create" })}
              >
                <Plus className="size-4" /> Add key
              </Button>
            )}

            {keys.length === 0 && !editing && (
              <p className="text-sm text-muted-foreground">
                No keys yet. Add one to use cloud models in the chat and in
                executions.
              </p>
            )}

            {keys.map((key) => (
              <div
                key={key.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-card p-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {key.alias}
                    <Badge variant="secondary">
                      {PROVIDER_LABELS[key.provider]}
                    </Badge>
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {key.masked}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  title="Edit"
                  onClick={() => setEditing({ mode: "edit", key })}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  title="Delete"
                  onClick={() => requestDelete(key)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
