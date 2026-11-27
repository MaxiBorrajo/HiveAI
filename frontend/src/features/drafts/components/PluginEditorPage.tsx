import { useEffect, useRef, useState } from "react";
import Editor, { DiffEditor, type BeforeMount } from "@monaco-editor/react";
import { reportError, reportSuccess } from "@/lib/toastManager";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FileCode,
  Loader2,
  Pencil,
  Rocket,
  Save,
  Undo2,
  X,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getDraftFiles,
  saveDraftFile,
  validateDraft,
  importDraft,
  exportDraft,
  type DraftFile,
  type DraftValidationResult,
} from "@/features/drafts/api/drafts";
import { chatEditDraftStream } from "@/features/drafts/api/chatEditDraft";
import { getPluginFiles } from "@/features/plugins/api/getPluginFiles";
import { exportPlugin } from "@/features/plugins/api/exportPlugin";
import { editPlugin } from "@/features/plugins/api/editPlugin";
import { DraftChatThread } from "@/features/drafts/components/DraftChatThread";
import { PluginTestChat } from "@/features/drafts/components/PluginTestChat";
import { UnsavedChangesDialog } from "@/features/drafts/components/UnsavedChangesDialog";
import { ValidationDialog } from "@/features/drafts/components/ValidationDialog";
import { InteractionDialog } from "@/features/interactions/components/InteractionDialog";
import type { OpenPlugin } from "@/features/drafts/DraftEditorContext";
import { ZOD_TYPES_STUB } from "@/features/drafts/lib/zodTypesStub";
import {
  buildFixPrompt,
  isDirty,
  type EditorMode,
  type LeaveTarget,
} from "@/features/drafts/lib/pluginEditorState";
import {
  addStep,
  addToolCall,
  failTurn,
  finishTurn,
  hasChanges,
  resolveToolCall,
  startTurn,
  type ThreadTurn,
} from "@/features/drafts/lib/draftChatThread";

interface PluginEditorPageProps {
  plugin: OpenPlugin;
  /** Reopen the editor on another plugin/kind (after publishing or moving to drafts). */
  onSwitch: (plugin: OpenPlugin) => void;
  onClose: () => void;
  /** The list of installed plugins changed. */
  onPluginsChanged: () => void;
}

type LeftTab = "assistant" | "test";

const INDEX = "index.ts";

export function PluginEditorPage({
  plugin,
  onSwitch,
  onClose,
  onPluginsChanged,
}: PluginEditorPageProps) {
  const { name, kind } = plugin;
  const isDraft = kind === "draft";

  const [files, setFiles] = useState<DraftFile[]>([]);
  const [savedIndex, setSavedIndex] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [activeFile, setActiveFile] = useState<string>(INDEX);
  const [mode, setMode] = useState<EditorMode>("view");
  const [leftTab, setLeftTab] = useState<LeftTab>("assistant");
  const [codeVersion, setCodeVersion] = useState(0);

  const [validation, setValidation] = useState<DraftValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [validationDialog, setValidationDialog] = useState<
    "save" | "publish" | null
  >(null);
  const [isSaving, setIsSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [leaveTarget, setLeaveTarget] = useState<LeaveTarget | null>(null);
  const [moveConfirmOpen, setMoveConfirmOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const justSavedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [chatInput, setChatInput] = useState("");
  const [isChatThinking, setIsChatThinking] = useState(false);
  const [turns, setTurns] = useState<ThreadTurn[]>([]);
  const [diff, setDiff] = useState<{ before: string; after: string } | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);

  const indexContent = files.find((f) => f.name === INDEX)?.content ?? "";
  const current = files.find((f) => f.name === activeFile);
  const dirty = isDirty(mode, indexContent, savedIndex);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    (isDraft ? getDraftFiles(name) : getPluginFiles(name))
      .then((loadedFiles) => {
        if (cancelled) return;
        setFiles(loadedFiles);
        setSavedIndex(loadedFiles.find((f) => f.name === INDEX)?.content ?? "");
        setActiveFile(INDEX);
        setMode(isDraft && plugin.startInEdit ? "edit" : "view");
        setLoaded(true);
        if (isDraft) void validateSilently();
      })
      .catch((error) => {
        if (cancelled) return;
        reportError([
          error instanceof Error ? error.message : "Could not open the plugin.",
        ]);
        onClose();
      });
    return () => {
      cancelled = true;
      chatAbortRef.current?.abort();
      if (justSavedTimeoutRef.current) clearTimeout(justSavedTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, kind]);

  const handleBeforeMount: BeforeMount = (monaco) => {
    const ts = monaco.languages.typescript.typescriptDefaults;
    ts.addExtraLib(ZOD_TYPES_STUB, "file:///node_modules/@types/zod/index.d.ts");
    const beePlugin = files.find((f) => f.name === "bee-plugin.ts");
    if (beePlugin) ts.addExtraLib(beePlugin.content, "file:///bee-plugin.ts");
  };

  function setIndexContent(content: string) {
    setFiles((prev) =>
      prev.map((f) => (f.name === INDEX ? { ...f, content } : f)),
    );
  }

  async function validateSilently(): Promise<DraftValidationResult | null> {
    setIsValidating(true);
    try {
      const result = await validateDraft(name);
      setValidation(result);
      return result;
    } catch (error) {
      reportError([
        error instanceof Error ? error.message : "Could not validate the plugin.",
      ]);
      return null;
    } finally {
      setIsValidating(false);
    }
  }

  /** Writes index.ts to disk. Returns false (after reporting) if it fails. */
  async function persist(content: string): Promise<boolean> {
    try {
      await saveDraftFile(name, INDEX, content);
      setSavedIndex(content);
      setCodeVersion((v) => v + 1);
      return true;
    } catch (error) {
      reportError([
        error instanceof Error ? error.message : "Could not save the file.",
      ]);
      return false;
    }
  }

  async function handleSave(): Promise<boolean> {
    setIsSaving(true);
    try {
      if (!(await persist(indexContent))) return false;
      if (justSavedTimeoutRef.current) clearTimeout(justSavedTimeoutRef.current);
      setJustSaved(true);
      justSavedTimeoutRef.current = setTimeout(() => setJustSaved(false), 2000);

      const result = await validateSilently();
      if (result && !result.valid) setValidationDialog("save");
      return true;
    } finally {
      setIsSaving(false);
    }
  }

  function finishExitEdit() {
    setMode("view");
    setDiff(null);
    setActiveFile(INDEX);
  }

  function requestExitEdit() {
    if (dirty) setLeaveTarget("exit-edit");
    else finishExitEdit();
  }

  function requestClose() {
    if (dirty) setLeaveTarget("close");
    else onClose();
  }

  function proceed(target: LeaveTarget) {
    setLeaveTarget(null);
    if (target === "close") onClose();
    else finishExitEdit();
  }

  async function handleLeaveSave() {
    if (!leaveTarget) return;
    if (await handleSave()) proceed(leaveTarget);
  }

  function handleLeaveDiscard() {
    if (!leaveTarget) return;
    setIndexContent(savedIndex);
    proceed(leaveTarget);
  }

  function handleEdit() {
    setMode("edit");
    setLeftTab("assistant");
  }

  async function handleExport() {
    setIsBusy(true);
    try {
      const path = isDraft
        ? await exportDraft(name)
        : (await exportPlugin(name)).data?.path;
      if (path) reportSuccess(`'${name}.zip' exported`, path);
    } catch (error) {
      reportError([
        error instanceof Error ? error.message : "Could not export the plugin.",
      ]);
    } finally {
      setIsBusy(false);
    }
  }

  async function handlePublish() {
    setIsBusy(true);
    try {
      const result = await validateSilently();
      if (!result) return;
      if (!result.valid) {
        setValidationDialog("publish");
        return;
      }
      const published = await importDraft(name);
      onPluginsChanged();
      reportSuccess(`'${published.name}' is now official`);
      onSwitch({ name: published.name, kind: "official" });
    } catch (error) {
      reportError([
        error instanceof Error ? error.message : "Could not publish the plugin.",
      ]);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleMoveToDrafts() {
    setMoveConfirmOpen(false);
    setIsBusy(true);
    try {
      const { success } = await editPlugin(name);
      if (success) {
        onPluginsChanged();
        onSwitch({ name, kind: "draft", startInEdit: true });
      }
    } finally {
      setIsBusy(false);
    }
  }

  function handleFixWithAi() {
    const issues = validation?.issues ?? [];
    setValidationDialog(null);
    setMode("edit");
    setLeftTab("assistant");
    void handleChatSend(buildFixPrompt(issues));
  }

  async function handleChatSend(promptOverride?: string) {
    const prompt = (promptOverride ?? chatInput).trim();
    if (!prompt || isChatThinking || !isDraft) return;
    // The assistant reads index.ts from disk, so unsaved edits must be there first.
    if (indexContent !== savedIndex && !(await persist(indexContent))) return;

    const before = indexContent;
    const turnId = crypto.randomUUID();
    if (!promptOverride) setChatInput("");
    setIsChatThinking(true);
    setDiff(null);
    setTurns((prev) => [...prev, startTurn(turnId, prompt, before)]);

    const controller = new AbortController();
    chatAbortRef.current = controller;
    const update = (change: (turn: ThreadTurn) => ThreadTurn) =>
      setTurns((prev) => prev.map((t) => (t.id === turnId ? change(t) : t)));

    try {
      await chatEditDraftStream(
        name,
        prompt,
        {
          onThinking: (message) => update((t) => addStep(t, "thinking", message)),
          onToolCall: ({ tool, input }) => update((t) => addToolCall(t, tool, input)),
          onToolResult: ({ tool, ok, output }) =>
            update((t) => resolveToolCall(t, tool, ok, output)),
          onWriting: (sourceCode, summary) => {
            update((t) => addStep(t, "thinking", summary ?? "Writing index.ts..."));
            setIndexContent(sourceCode);
            setActiveFile(INDEX);
          },
          onValidating: () =>
            update((t) => addStep(t, "validating", "Validating draft...")),
          onValidationError: ({ attempt, issues }) =>
            update((t) =>
              addStep(
                t,
                "correction",
                `Fixing ${issues.length} issue${issues.length === 1 ? "" : "s"} (attempt ${attempt}): ${issues.join("; ")}`,
              ),
            ),
          onDone: async ({ summary, sourceCode }) => {
            update((t) => finishTurn(t, summary, sourceCode));
            const reloaded = await getDraftFiles(name);
            setFiles(reloaded);
            setSavedIndex(reloaded.find((f) => f.name === INDEX)?.content ?? "");
            setCodeVersion((v) => v + 1);
            setActiveFile(INDEX);
            await validateSilently();
          },
          onError: (message) => update((t) => failTurn(t, message)),
        },
        controller.signal,
      );
    } catch (e) {
      update((t) =>
        failTurn(
          t,
          controller.signal.aborted
            ? "Generation stopped."
            : `Streaming error: ${(e as Error).message}`,
        ),
      );
    } finally {
      if (chatAbortRef.current === controller) chatAbortRef.current = null;
      setIsChatThinking(false);
    }
  }

  async function handleUndo(turn: ThreadTurn) {
    setDiff(null);
    setIndexContent(turn.before);
    setTurns((prev) =>
      prev.map((t) => (t.id === turn.id ? { ...t, after: turn.before } : t)),
    );
    if (await persist(turn.before)) {
      await validateSilently();
      reportSuccess("Reverted the last change");
    }
  }

  const lastDone = [...turns].reverse().find((t) => t.status === "done");
  const undoableTurnId =
    lastDone && hasChanges(lastDone) && lastDone.after === indexContent
      ? lastDone.id
      : null;
  const showBeePlugin = files.some((f) => f.name === "bee-plugin.ts");
  const editing = mode === "edit";
  const busy = isBusy || isSaving || isChatThinking;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <InteractionDialog />

      <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon" onClick={requestClose} className="size-8">
            <ArrowLeft size={16} />
          </Button>
          <span className="truncate font-mono text-sm font-semibold">{name}</span>
          <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
            {isDraft ? "Draft" : "Official"}
          </span>
          {dirty && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-full bg-amber-500" /> Unsaved changes
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!editing && (
            <Button
              variant="ghost"
              className="gap-1.5"
              onClick={handleExport}
              disabled={busy || !loaded}
            >
              <Download size={14} /> Export .zip
            </Button>
          )}
          {!editing && isDraft && (
            <>
              <Button
                variant="secondary"
                className="gap-1.5"
                onClick={handlePublish}
                disabled={busy || !loaded}
                title="Make this plugin official: it gets installed and becomes available to chats and flows"
              >
                {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />}
                Publish
              </Button>
              <Button className="gap-1.5" onClick={handleEdit} disabled={busy || !loaded}>
                <Pencil size={14} /> Edit
              </Button>
            </>
          )}
          {!editing && !isDraft && (
            <Button
              className="gap-1.5"
              onClick={() => setMoveConfirmOpen(true)}
              disabled={busy || !loaded}
              title="Turn it back into a draft so you can modify it"
            >
              <Undo2 size={14} /> Move to drafts to edit
            </Button>
          )}
          {editing && (
            <>
              <Button
                className="gap-1.5"
                onClick={() => void handleSave()}
                disabled={isSaving || isChatThinking || !dirty}
              >
                {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {justSaved && !dirty ? "Saved" : "Save"}
              </Button>
              <Button variant="secondary" onClick={requestExitEdit} disabled={isChatThinking}>
                Exit edit mode
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-full max-w-md min-h-0 flex-col border-r border-border">
          <div className="flex gap-1 border-b border-border px-3 py-1.5">
            {(["assistant", "test"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={leftTab === tab}
                onClick={() => setLeftTab(tab)}
                className={`rounded px-2.5 py-1 text-xs ${
                  leftTab === tab
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50"
                }`}
              >
                {tab === "assistant" ? "Assistant" : "Test"}
              </button>
            ))}
          </div>

          {leftTab === "assistant" ? (
            <DraftChatThread
              turns={turns}
              input={chatInput}
              setInput={setChatInput}
              isThinking={isChatThinking}
              onSend={() => void handleChatSend()}
              onStop={() => chatAbortRef.current?.abort()}
              onViewChanges={(turn) =>
                setDiff({ before: turn.before, after: turn.after ?? "" })
              }
              onUndo={handleUndo}
              undoableTurnId={editing ? undoableTurnId : null}
              disabled={!editing}
            />
          ) : (
            <PluginTestChat
              kind={kind}
              name={name}
              codeVersion={codeVersion}
              hasUnsavedChanges={dirty}
            />
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
            <div className="flex items-center gap-1">
              <button
                type="button"
                role="tab"
                aria-selected={activeFile === INDEX && !diff}
                onClick={() => {
                  setActiveFile(INDEX);
                  setDiff(null);
                }}
                className={`flex items-center gap-1.5 rounded px-2 py-1 font-mono text-xs ${
                  activeFile === INDEX && !diff
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50"
                }`}
              >
                <FileCode className="size-3.5" /> index.ts
              </button>
              {diff && (
                <span className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs text-accent-foreground">
                  Changes
                  <button
                    type="button"
                    aria-label="Close changes"
                    onClick={() => setDiff(null)}
                    className="rounded hover:bg-background/40"
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              )}
              {showBeePlugin && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeFile === "bee-plugin.ts" && !diff}
                  onClick={() => {
                    setActiveFile("bee-plugin.ts");
                    setDiff(null);
                  }}
                  className={`ml-2 rounded px-2 py-1 font-mono text-xs ${
                    activeFile === "bee-plugin.ts" && !diff
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground opacity-70 hover:bg-accent/50"
                  }`}
                  title="The BeePlugin interface this plugin is checked against"
                >
                  bee-plugin.ts · reference
                </button>
              )}
            </div>

            {isDraft && (
              <ValidationStatus
                validation={validation}
                isValidating={isValidating}
                onShow={() => setValidationDialog("save")}
              />
            )}
          </div>

          <div className="min-h-0 flex-1">
            {diff ? (
              <DiffEditor
                original={diff.before}
                modified={diff.after}
                language="typescript"
                theme="vs-dark"
                options={{
                  readOnly: true,
                  renderSideBySide: false,
                  minimap: { enabled: false },
                  fontSize: 13,
                  automaticLayout: true,
                }}
              />
            ) : (
              current && (
                <Editor
                  key={current.name}
                  path={`file:///${current.name}`}
                  language="typescript"
                  value={current.content}
                  onChange={(value) => {
                    if (editing && activeFile === INDEX) setIndexContent(value ?? "");
                  }}
                  beforeMount={handleBeforeMount}
                  options={{
                    readOnly: !editing || activeFile !== INDEX,
                    minimap: { enabled: false },
                    fontSize: 13,
                    automaticLayout: true,
                  }}
                  theme="vs-dark"
                />
              )
            )}
          </div>
        </div>
      </div>

      <UnsavedChangesDialog
        open={leaveTarget !== null}
        isSaving={isSaving}
        onSave={() => void handleLeaveSave()}
        onDiscard={handleLeaveDiscard}
        onKeepEditing={() => setLeaveTarget(null)}
      />

      <ValidationDialog
        open={validationDialog !== null && !!validation && !validation.valid}
        issues={validation?.issues ?? []}
        context={validationDialog ?? "save"}
        onFixWithAi={handleFixWithAi}
        onClose={() => {
          if (validationDialog === "publish") setMode("edit");
          setValidationDialog(null);
        }}
      />

      <Dialog open={moveConfirmOpen} onOpenChange={setMoveConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move '{name}' to drafts?</DialogTitle>
            <DialogDescription>
              While it is a draft the plugin is not installed, so chats and
              flows that use it will not work until you publish it again. Its
              settings and on/off state are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setMoveConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleMoveToDrafts()}>Move to drafts</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ValidationStatus({
  validation,
  isValidating,
  onShow,
}: {
  validation: DraftValidationResult | null;
  isValidating: boolean;
  onShow: () => void;
}) {
  if (isValidating) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Validating...
      </span>
    );
  }
  if (!validation) return null;
  if (validation.valid) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CheckCircle2 className="size-3.5 text-primary" /> Valid
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onShow}
      className="flex items-center gap-1.5 text-xs text-destructive hover:underline"
    >
      <XCircle className="size-3.5" /> {validation.issues.length} issue
      {validation.issues.length === 1 ? "" : "s"}
    </button>
  );
}
