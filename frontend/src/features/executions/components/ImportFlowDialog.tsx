import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  importExecution,
  previewImport,
  type ImportPreview,
} from "../api/importExecution";
import { reportSuccess, reportWarning } from "@/lib/toastManager";

interface ImportFlowDialogProps {
  /** Parsed file content, or the raw text when it is not valid JSON. */
  fileContent: string | null;
  onClose: () => void;
  onImported: (executionId: string) => void;
}

export function ImportFlowDialog({
  fileContent,
  onClose,
  onImported,
}: ImportFlowDialogProps) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [installPlugins, setInstallPlugins] = useState<Set<string>>(new Set());
  const [conflict, setConflict] = useState<"new" | "overwrite">("new");
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  useEffect(() => {
    setPreview(null);
    setErrors([]);
    setConfirmOverwrite(false);
    setConflict("new");
    if (fileContent === null) return;
    let cancelled = false;
    setIsBusy(true);
    previewImport(fileContent).then((outcome) => {
      if (cancelled) return;
      setIsBusy(false);
      if (!outcome.ok) return setErrors(outcome.errors);
      setPreview(outcome.data);
      setInstallPlugins(
        new Set(
          outcome.data.bundledPlugins
            .filter((p) => p.status === "missing")
            .map((p) => p.name),
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [fileContent]);

  function togglePlugin(name: string) {
    setInstallPlugins((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function handleImport() {
    if (!preview || fileContent === null) return;
    if (preview.nameConflict && conflict === "overwrite" && !confirmOverwrite) {
      setConfirmOverwrite(true);
      return;
    }
    setIsBusy(true);
    const outcome = await importExecution(fileContent, {
      conflict: preview.nameConflict ? conflict : undefined,
      installBundledPlugins: [...installPlugins],
    });
    setIsBusy(false);
    if (!outcome.ok) {
      setErrors(outcome.errors);
      return;
    }
    const { data } = outcome;
    for (const plugin of data.plugins.filter((p) => !p.installed)) {
      reportWarning(`Could not install ${plugin.name}`, plugin.error);
    }
    if (data.isDraft) {
      reportWarning(
        `"${data.name}" imported as a draft`,
        `Missing plugins: ${data.missingPlugins.join(", ")}. It cannot run until they are installed.`,
      );
    } else {
      reportSuccess(`"${data.name}" imported`);
    }
    onImported(String(data.executionId));
    onClose();
  }

  const blocking = errors.length > 0 || (preview?.violations.length ?? 0) > 0;

  return (
    <Dialog open={fileContent !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import execution</DialogTitle>
          <DialogDescription>
            {preview ? `"${preview.name}"` : "Checking the file..."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto text-sm">
          {errors.map((error) => (
            <p key={error} className="text-destructive">
              {error}
            </p>
          ))}

          {preview?.violations.map((v, i) => (
            <p key={i} className="text-destructive">
              {v.nodeName}: {v.reason}
            </p>
          ))}

          {preview && preview.missingPlugins.length > 0 && (
            <p className="text-amber-600">
              Missing plugins: {preview.missingPlugins.join(", ")}.
              {preview.unbundledMissingPlugins.length > 0 &&
                ` Not included in the file: ${preview.unbundledMissingPlugins.join(", ")}.`}{" "}
              The execution will be imported as a draft and will not run until
              they are installed.
            </p>
          )}

          {preview && preview.inactivePlugins.length > 0 && (
            <p className="text-muted-foreground">
              Installed but inactive (activate them to run): {" "}
              {preview.inactivePlugins.join(", ")}.
            </p>
          )}

          {preview?.bundledPlugins.map((plugin) =>
            plugin.status === "missing" ? (
              <label key={plugin.name} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={installPlugins.has(plugin.name)}
                  onChange={() => togglePlugin(plugin.name)}
                />
                <span>
                  Install plugin <b>{plugin.name}</b> included in the file.
                  Plugins run code on this computer: only install ones you trust.
                </span>
              </label>
            ) : (
              <p key={plugin.name} className="text-muted-foreground">
                Plugin {plugin.name} is already installed: your local version
                will be used.
              </p>
            ),
          )}

          {preview && preview.secretWarnings.length > 0 && (
            <p className="text-amber-600">
              {preview.secretWarnings.length} field(s) look like they contain a
              secret. Review the execution after importing.
            </p>
          )}

          {preview?.nameConflict && (
            <div className="flex flex-col gap-1">
              <p>An execution with this name already exists.</p>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={conflict === "new"}
                  onChange={() => {
                    setConflict("new");
                    setConfirmOverwrite(false);
                  }}
                />
                Import as a new copy
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={conflict === "overwrite"}
                  onChange={() => setConflict("overwrite")}
                />
                Replace the existing graph (kept as a previous version)
              </label>
              {confirmOverwrite && (
                <p className="text-destructive">
                  Click Replace again to confirm.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={isBusy || blocking || !preview}
            onClick={handleImport}
          >
            {preview?.nameConflict && conflict === "overwrite"
              ? "Replace"
              : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
