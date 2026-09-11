import { useEffect, useRef, useState } from "react";
import Editor, { type BeforeMount } from "@monaco-editor/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CheckCircle2, Download, Loader2, Save, XCircle } from "lucide-react";
import {
  getDraftFiles,
  saveDraftFile,
  validateDraft,
  importDraft,
  exportDraft,
  type DraftFile,
  type DraftValidationResult,
} from "@/lib/get-drafts";

// Monaco has no access to the real node_modules/Deno cache, so without help
// it flags `import ... from "zod"` as an unresolved module. This is a
// deliberately minimal stub — just enough of zod's shape for the scaffolded
// plugin code to type-check in the editor — not a full port of zod's types.
// Real validation of the plugin (including its actual zod usage) still runs
// for real in the backend subprocess; this only avoids a misleading red
// squiggle while editing.
const ZOD_TYPES_STUB = `
declare module "zod" {
  export interface ZodType<Output = unknown> {
    _output: Output;
    optional(): ZodType<Output | undefined>;
    describe(description: string): this;
  }
  interface ZodStringType extends ZodType<string> {}
  interface ZodNumberType extends ZodType<number> {}
  interface ZodBooleanType extends ZodType<boolean> {}
  interface ZodObjectType<Shape extends Record<string, ZodType>>
    extends ZodType<{ [K in keyof Shape]: Shape[K]["_output"] }> {}
  interface ZodArrayType<Item extends ZodType> extends ZodType<Item["_output"][]> {}

  // z is both a value (the object with .object(), .string(), etc. below)
  // and a namespace (so "z.infer<typeof schema>" resolves) — TypeScript
  // merges the const and the namespace declared under the same name.
  export const z: {
    string(): ZodStringType;
    number(): ZodNumberType;
    boolean(): ZodBooleanType;
    object<Shape extends Record<string, ZodType>>(shape: Shape): ZodObjectType<Shape>;
    array<Item extends ZodType>(item: Item): ZodArrayType<Item>;
    unknown(): ZodType<unknown>;
  };
  export namespace z {
    export type infer<T extends ZodType> = T["_output"];
  }
}
`;

interface DraftEditorPageProps {
  draftName: string;
  onClose: () => void;
  onImported: () => void;
}

const SAVE_DEBOUNCE_MS = 600;

export function DraftEditorPage({ draftName, onClose, onImported }: DraftEditorPageProps) {
  const [files, setFiles] = useState<DraftFile[]>([]);
  const [activeFile, setActiveFile] = useState<string>("index.ts");
  const [validation, setValidation] = useState<DraftValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const justSavedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setValidation(null);
    setImportError(null);
    getDraftFiles(draftName).then((loaded) => {
      setFiles(loaded);
      setActiveFile("index.ts");
    });
  }, [draftName]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (justSavedTimeoutRef.current) clearTimeout(justSavedTimeoutRef.current);
    };
  }, []);

  const current = files.find((f) => f.name === activeFile);

  const handleBeforeMount: BeforeMount = (monaco) => {
    const ts = monaco.languages.typescript.typescriptDefaults;
    ts.addExtraLib(ZOD_TYPES_STUB, "file:///node_modules/@types/zod/index.d.ts");

    const beePlugin = files.find((f) => f.name === "bee-plugin.ts");
    if (beePlugin) {
      ts.addExtraLib(beePlugin.content, "file:///bee-plugin.ts");
    }
  };

  async function saveAndValidate(name: string, content: string) {
    setSaveError(null);
    try {
      await saveDraftFile(draftName, name, content);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save the file.");
      return;
    }

    if (justSavedTimeoutRef.current) clearTimeout(justSavedTimeoutRef.current);
    setJustSaved(true);
    justSavedTimeoutRef.current = setTimeout(() => setJustSaved(false), 2000);

    setIsValidating(true);
    try {
      const result = await validateDraft(draftName);
      setValidation(result);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not validate the plugin.");
    } finally {
      setIsValidating(false);
    }
  }

  function handleChange(value: string | undefined) {
    const content = value ?? "";
    setFiles((prev) =>
      prev.map((f) => (f.name === activeFile ? { ...f, content } : f)),
    );

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveAndValidate(activeFile, content);
    }, SAVE_DEBOUNCE_MS);
  }

  function handleSaveNow() {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    if (current) saveAndValidate(current.name, current.content);
  }

  async function handleExport() {
    setIsExporting(true);
    setExportError(null);
    try {
      await exportDraft(draftName);
      toast.success(`'${draftName}.zip' downloaded.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not export the plugin.";
      setExportError(message);
      toast.error(message);
    } finally {
      setIsExporting(false);
    }
  }

  async function handleImport() {
    setIsImporting(true);
    setImportError(null);
    try {
      await importDraft(draftName);
      onImported();
      onClose();
      toast.success(`'${draftName}' imported successfully.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not import the plugin.";
      setImportError(message);
      toast.error(message);
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex items-center justify-between gap-4 border-b border-border p-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onClose} className="size-8">
            <ArrowLeft size={16} />
          </Button>
          <span className="font-mono text-sm font-semibold">{draftName}</span>
        </div>
        <div className="flex items-center gap-2">
          {files.map((f) => (
            <button
              key={f.name}
              onClick={() => setActiveFile(f.name)}
              className={`rounded px-2 py-1 text-xs font-mono ${
                activeFile === f.name
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50"
              }`}
            >
              {f.name}
              {f.name === "bee-plugin.ts" && (
                <span className="ml-1 opacity-60">(read-only)</span>
              )}
            </button>
          ))}
          {activeFile === "index.ts" && (
            <Button
              variant="secondary"
              size="sm"
              className="h-7 gap-1.5"
              onClick={handleSaveNow}
              disabled={isValidating}
            >
              {isValidating ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Save size={12} />
              )}
              {justSaved ? "Saved" : "Save"}
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {current && (
          <Editor
            key={current.name}
            path={`file:///${current.name}`}
            language="typescript"
            value={current.content}
            onChange={activeFile === "index.ts" ? handleChange : undefined}
            beforeMount={handleBeforeMount}
            options={{
              readOnly: activeFile !== "index.ts",
              minimap: { enabled: false },
              fontSize: 13,
              automaticLayout: true,
            }}
            theme="vs-dark"
          />
        )}
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-border p-4">
        <div className="flex-1 min-w-0">
          {saveError && (
            <p className="mb-1 flex items-center gap-1.5 text-xs text-destructive">
              <XCircle size={12} className="shrink-0" /> {saveError}
            </p>
          )}
          {isValidating ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" /> Validating...
            </span>
          ) : validation ? (
            validation.valid ? (
              <span className="flex items-center gap-1.5 text-xs text-emerald-500">
                <CheckCircle2 size={12} /> Ready to import.
              </span>
            ) : (
              <div className="flex items-start gap-1.5 text-xs text-destructive">
                <XCircle size={12} className="mt-0.5 shrink-0" />
                <ul className="list-disc space-y-0.5 pl-4">
                  {validation.issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              </div>
            )
          ) : (
            <span className="text-xs text-muted-foreground">
              Edit index.ts (or click Save) to validate the plugin before importing it.
            </span>
          )}
          {importError && (
            <p className="mt-1 text-xs text-destructive">{importError}</p>
          )}
          {exportError && (
            <p className="mt-1 text-xs text-destructive">{exportError}</p>
          )}
        </div>

        <div className="flex shrink-0 gap-2">
          <Button
            variant="secondary"
            onClick={handleExport}
            disabled={isExporting}
            className="gap-1.5"
          >
            {isExporting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Download size={14} />
            )}
            {isExporting ? "Exporting..." : "Export .zip"}
          </Button>

          <Button
            onClick={handleImport}
            disabled={!validation?.valid || isImporting}
            className="gap-1.5"
          >
            {isImporting && <Loader2 size={14} className="animate-spin" />}
            {isImporting ? "Importing..." : "Import Plugin"}
          </Button>
        </div>
      </div>
    </div>
  );
}
