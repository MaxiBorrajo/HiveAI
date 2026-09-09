import { useRef } from "react";
import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TestTube, Upload, Trash2, Download, Pencil, Loader2 } from "lucide-react";
import type { Plugin } from "@/types/plugin";
import { DraftListView } from "./DraftListView";
import { exportPlugin } from "@/lib/get-plugins";

interface PluginListViewProps {
  plugins: Plugin[];
  onToggle: (plugin: Plugin, nextActive: boolean) => void;
  onSelectPlugin: (name: string) => void;
  onImportPlugin: (files: FileList) => void;
  onRemovePlugin: (plugin: Plugin) => void;
  onEditPlugin: (plugin: Plugin) => void;
  isImporting: boolean;
  importError: string | null;
  onDismissImportError: () => void;
  onOpenDraft: (name: string) => void;
}

export function PluginListView({
  plugins,
  onToggle,
  onSelectPlugin,
  onImportPlugin,
  onRemovePlugin,
  onEditPlugin,
  isImporting,
  importError,
  onDismissImportError,
  onOpenDraft,
}: PluginListViewProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleExport(plugin: Plugin) {
    try {
      await exportPlugin(plugin.name);
    } catch {
      // Best-effort — export failures aren't currently surfaced anywhere in
      // this view; the download simply won't start.
    }
  }

  function handleFilesChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (files && files.length > 0) {
      onImportPlugin(files);
    }
    // Reset so picking the same folder again still fires a change event.
    event.target.value = "";
  }

  return (
    <>
      <DialogHeader className="flex-row items-center justify-between p-6 pb-0 space-y-0">
        <DialogTitle>Manage Plugins</DialogTitle>
        <Button
          variant="secondary"
          size="sm"
          className="gap-1.5"
          disabled={isImporting}
          onClick={() => fileInputRef.current?.click()}
        >
          {isImporting ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Upload size={14} />
          )}
          {isImporting ? "Importing..." : "Import Plugin"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFilesChosen}
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        />
      </DialogHeader>

      {importError && (
        <div className="mx-6 mt-3 flex items-start justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <span>{importError}</span>
          <button
            onClick={onDismissImportError}
            className="shrink-0 opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      <ScrollArea className="flex-1 p-6 pt-2">
        <div className="flex flex-col gap-3">
          {plugins.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No plugins registered.
            </p>
          )}

          {plugins.map((plugin) => (
            <div
              key={plugin.id}
              className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-sm font-semibold items-center flex gap-2 mb-2">
                    <Switch
                      checked={plugin.active}
                      onCheckedChange={(checked) => onToggle(plugin, checked)}
                      className="mt-0.5"
                    />{" "}
                    {plugin.name}
                    {plugin.isExternal && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                        imported
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {plugin.description}
                  </p>
                </div>

                <div className="flex shrink-0 gap-2">
                  {((plugin.selectionTests && plugin.selectionTests.length > 0) ||
                    (plugin.executionTests &&
                      plugin.executionTests.length > 0)) && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onSelectPlugin(plugin.name)}
                      className="h-8 gap-1 px-3"
                    >
                      <TestTube size={12} />
                      <span>Tests</span>
                    </Button>
                  )}
                  {plugin.isExternal && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onEditPlugin(plugin)}
                      className="h-8 gap-1 px-3"
                      title="Edit"
                    >
                      <Pencil size={12} />
                    </Button>
                  )}
                  {plugin.isExternal && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleExport(plugin)}
                      className="h-8 gap-1 px-3"
                      title="Export as .zip"
                    >
                      <Download size={12} />
                    </Button>
                  )}
                  {plugin.isExternal && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onRemovePlugin(plugin)}
                      className="h-8 gap-1 px-3 text-destructive hover:text-destructive"
                    >
                      <Trash2 size={12} />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="my-4 border-t border-border" />

        <DraftListView onOpenDraft={onOpenDraft} />
      </ScrollArea>
    </>
  );
}
