import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Loader2,
  RotateCcw,
  Settings,
  Wrench,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatInput } from "@/features/chats/components/ChatInput";
import { MessageMarkdown } from "@/features/chats/components/MessageMarkdown";
import { PluginConfigDialog } from "@/features/plugins/components/PluginConfigDialog";
import {
  installedPluginConfigApi,
  draftConfigApi,
} from "@/features/plugins/api/pluginConfig";
import type { PluginConfigFieldValue } from "@/features/plugins/types";
import type { PluginKind } from "../DraftEditorContext";
import { testChatStream } from "../api/testChat";
import { describeToolInput } from "../lib/draftChatThread";
import {
  finishToolRun,
  needsConfiguration,
  startToolRun,
  type TestToolRun,
} from "../lib/pluginEditorState";

interface TestMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools: TestToolRun[];
  pending?: boolean;
  isError?: boolean;
}

interface PluginTestChatProps {
  kind: PluginKind;
  name: string;
  /** Bumps every time the code is saved, so the settings are read again. */
  codeVersion: number;
  hasUnsavedChanges: boolean;
}

export function PluginTestChat({
  kind,
  name,
  codeVersion,
  hasUnsavedChanges,
}: PluginTestChatProps) {
  const configApi = kind === "draft" ? draftConfigApi : installedPluginConfigApi;
  const [messages, setMessages] = useState<TestMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<PluginConfigFieldValue[] | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadFields = useCallback(async () => {
    try {
      const { data } = await configApi.get(name);
      setFields(data ?? []);
    } catch {
      setFields(null);
    }
  }, [configApi, name]);

  useEffect(() => {
    void loadFields();
  }, [loadFields, codeVersion]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  function patchLast(change: (m: TestMessage) => TestMessage) {
    setMessages((prev) =>
      prev.map((m, i) => (i === prev.length - 1 ? change(m) : m)),
    );
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || busy) return;

    const history = messages
      .filter((m) => !m.pending && !m.isError && m.content)
      .map((m) => ({ role: m.role, content: m.content }));
    setInput("");
    setBusy(true);
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", content: text, tools: [] },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        tools: [],
        pending: true,
      },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await testChatStream(
        kind,
        name,
        text,
        history,
        {
          onToolCall: ({ tool, input: args }) =>
            patchLast((m) => ({ ...m, tools: startToolRun(m.tools, tool, args) })),
          onToolResult: ({ tool, ok, output }) =>
            patchLast((m) => ({
              ...m,
              tools: finishToolRun(m.tools, tool, ok, output),
            })),
          onAnswer: (content) =>
            patchLast((m) => ({ ...m, content, pending: false })),
          onError: (message) =>
            patchLast((m) => ({
              ...m,
              content: message,
              pending: false,
              isError: true,
            })),
        },
        controller.signal,
      );
    } catch (e) {
      patchLast((m) => ({
        ...m,
        pending: false,
        isError: true,
        content: controller.signal.aborted
          ? "Stopped."
          : `Streaming error: ${(e as Error).message}`,
      }));
    } finally {
      patchLast((m) => (m.pending ? { ...m, pending: false } : m));
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  }

  const hasFields = (fields?.length ?? 0) > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground">
        <div className="flex items-center justify-between gap-2">
          <span>
            Talks only to <span className="font-mono">{name}</span>. It runs
            for real.
          </span>
          <div className="flex shrink-0 gap-1">
            {hasFields && (
              <Button
                variant="ghost"
                size="xs"
                className="gap-1"
                onClick={() => setConfigOpen(true)}
              >
                <Settings /> Settings
              </Button>
            )}
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="xs"
                className="gap-1"
                disabled={busy}
                onClick={() => setMessages([])}
              >
                <RotateCcw /> Clear
              </Button>
            )}
          </div>
        </div>
        <span>
          {kind === "draft"
            ? "Tests the last saved version of the code."
            : "Tests the installed version."}
          {hasUnsavedChanges && " You have unsaved changes that are not included."}
        </span>
        {needsConfiguration(fields) && (
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-2 text-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="flex flex-col gap-1.5">
              <span>
                This plugin uses settings (
                {fields!.map((f) => f.label).join(", ")}) and none is set yet.
              </span>
              <Button
                size="xs"
                variant="secondary"
                className="self-start"
                onClick={() => setConfigOpen(true)}
              >
                Configure
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="my-auto text-center text-sm text-muted-foreground">
            Ask for something the plugin should do, like you would in a chat.
          </p>
        )}
        {messages.map((m) => (
          <TestMessageView key={m.id} message={m} />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex flex-col items-center gap-2 border-t border-border px-4 pt-3 pb-3">
        <ChatInput
          input={input}
          setInput={setInput}
          isThinking={busy}
          handleSend={handleSend}
          handleStop={() => abortRef.current?.abort()}
          isEmpty={messages.length === 0}
          hidePluginsAndModes
          placeholder="Try the plugin..."
        />
      </div>

      <PluginConfigDialog
        pluginName={configOpen ? name : null}
        api={configApi}
        onOpenChange={(open) => {
          setConfigOpen(open);
          if (!open) void loadFields();
        }}
      />
    </div>
  );
}

function TestMessageView({ message }: { message: TestMessage }) {
  if (message.role === "user") {
    return (
      <div className="ml-8 self-end rounded-2xl rounded-br-sm bg-secondary px-3 py-2 text-sm whitespace-pre-wrap wrap-break-word">
        {message.content}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 text-sm">
      {message.tools.map((run) => (
        <ToolRunView key={run.id} run={run} />
      ))}
      {message.pending && !message.content && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Working...
        </span>
      )}
      {message.content &&
        (message.isError ? (
          <p className="flex items-start gap-1.5 whitespace-pre-wrap text-destructive">
            <XCircle className="mt-0.5 size-4 shrink-0" />
            {message.content}
          </p>
        ) : (
          <MessageMarkdown content={message.content} />
        ))}
    </div>
  );
}

function ToolRunView({ run }: { run: TestToolRun }) {
  const [open, setOpen] = useState(false);
  const detail = describeToolInput(run.input);
  return (
    <div className="rounded-lg border border-border text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-muted-foreground hover:text-foreground"
      >
        {run.status === "running" ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
        ) : run.status === "ok" ? (
          <Wrench className="size-3.5 shrink-0" />
        ) : (
          <XCircle className="size-3.5 shrink-0 text-destructive" />
        )}
        <span className="font-mono">{run.tool}</span>
        {detail && <span className="min-w-0 flex-1 truncate">{detail}</span>}
      </button>
      {open && (
        <pre className="max-h-48 overflow-auto border-t border-border p-2 font-mono whitespace-pre-wrap wrap-break-word select-text">
          {JSON.stringify(run.input, null, 2)}
          {run.output ? `\n\n${run.output}` : ""}
        </pre>
      )}
    </div>
  );
}
