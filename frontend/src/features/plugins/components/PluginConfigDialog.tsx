import { useCallback, useEffect, useState } from "react";
import { Settings } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  deletePluginConfigValue,
  getPluginConfig,
  setPluginConfigValue,
} from "../api/pluginConfig";
import type { PluginConfigFieldValue } from "../types";

interface PluginConfigDialogProps {
  pluginName: string | null;
  onOpenChange: (open: boolean) => void;
}

function errorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { errors?: string[] } } })
    ?.response?.data;
  return data?.errors?.[0] ?? (error as Error)?.message ?? "Something went wrong";
}

function FieldRow({
  pluginName,
  field,
  onSaved,
}: {
  pluginName: string;
  field: PluginConfigFieldValue;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(field.value ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const hasValue = field.masked !== null || field.value !== null;

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await setPluginConfigValue(pluginName, field.key, value);
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    setError(null);
    setSaving(true);
    try {
      await deletePluginConfigValue(pluginName, field.key);
      setValue("");
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
      <label className="flex flex-col gap-1 text-xs">
        {field.label}
        <Input
          type={field.secret ? "password" : "text"}
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={field.secret ? field.masked ?? "Not set" : "Not set"}
        />
      </label>
      {field.secret && (
        <p className="text-xs text-muted-foreground">
          Stored encrypted on this device. It is never shown again.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {hasValue && (
          <Button variant="ghost" size="sm" onClick={clear} disabled={saving}>
            Clear
          </Button>
        )}
        <Button
          size="sm"
          onClick={save}
          disabled={saving || !value.trim()}
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}

export function PluginConfigDialog({
  pluginName,
  onOpenChange,
}: PluginConfigDialogProps) {
  const [fields, setFields] = useState<PluginConfigFieldValue[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!pluginName) return;
    try {
      const { data } = await getPluginConfig(pluginName);
      setFields(data ?? []);
      setLoaded(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [pluginName]);

  useEffect(() => {
    if (pluginName) {
      setError(null);
      setLoaded(false);
      load();
    }
  }, [pluginName, load]);

  return (
    <Dialog open={!!pluginName} onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent className="w-[90vw] max-w-lg" showCloseButton>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="size-4" /> Configure {pluginName}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          {loaded && fields.length === 0 && (
            <p className="text-sm text-muted-foreground">
              This plugin has no configurable values.
            </p>
          )}
          {fields.map((field) => (
            <FieldRow
              key={field.key}
              pluginName={pluginName!}
              field={field}
              onSaved={load}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
