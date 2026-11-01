import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Columns2,
  Copy,
  Loader2,
  Search,
  Undo2,
  Wrench,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatInput } from "@/features/chats/components/ChatInput";
import { copyToClipboard } from "@/lib/errorDetails";
import { reportSuccess } from "@/lib/toastManager";
import {
  describeToolInput,
  hasChanges,
  type ThreadStep,
  type ThreadTurn,
} from "../lib/draftChatThread";

interface DraftChatThreadProps {
  turns: ThreadTurn[];
  input: string;
  setInput: (value: string) => void;
  isThinking: boolean;
  onSend: () => void;
  onStop: () => void;
  onViewChanges: (turn: ThreadTurn) => void;
  onUndo: (turn: ThreadTurn) => void;
  /** Id of the last finished turn, the only one that can still be undone. */
  undoableTurnId: string | null;
  /** View mode: the history stays visible but nothing can be asked. */
  disabled?: boolean;
}

export function DraftChatThread({
  turns,
  input,
  setInput,
  isThinking,
  onSend,
  onStop,
  onViewChanges,
  onUndo,
  undoableTurnId,
  disabled = false,
}: DraftChatThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
        {turns.map((turn) => (
          <TurnView
            key={turn.id}
            turn={turn}
            canUndo={turn.id === undoableTurnId && !isThinking}
            onViewChanges={onViewChanges}
            onUndo={onUndo}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex flex-col items-center gap-2 border-t border-border px-4 pt-3 pb-3">
        {disabled ? (
          <p className="w-full rounded-lg border border-dashed border-border px-3 py-3 text-center text-sm text-muted-foreground">
            Press <b>Edit</b> to ask the assistant for changes.
          </p>
        ) : (
          <>
            <ChatInput
              input={input}
              setInput={setInput}
              isThinking={isThinking}
              handleSend={onSend}
              handleStop={onStop}
              isEmpty={turns.length === 0}
              hidePluginsAndModes
              placeholder="I want a plugin that sends a message to a Slack webhook..."
            />
            <p className="text-center text-xs text-muted-foreground">
              HiveAI can make mistakes. Review the generated code before importing.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function TurnView({
  turn,
  canUndo,
  onViewChanges,
  onUndo,
}: {
  turn: ThreadTurn;
  canUndo: boolean;
  onViewChanges: (turn: ThreadTurn) => void;
  onUndo: (turn: ThreadTurn) => void;
}) {
  const running = turn.status === "running";
  const [showSteps, setShowSteps] = useState(true);

  useEffect(() => {
    if (!running) setShowSteps(false);
  }, [running]);

  return (
    <div className="flex flex-col gap-2">
      <div className="ml-8 self-end rounded-2xl rounded-br-sm bg-secondary px-3 py-2 text-sm whitespace-pre-wrap wrap-break-word">
        {turn.prompt}
      </div>

      <div className="flex flex-col gap-2 text-sm">
        {turn.steps.length > 0 && (
          <div className="rounded-lg border border-border">
            <button
              type="button"
              onClick={() => setShowSteps((open) => !open)}
              className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs text-muted-foreground"
            >
              {showSteps ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
              {running ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              <span className="min-w-0 flex-1 truncate">
                {running
                  ? turn.steps[turn.steps.length - 1].text
                  : `${turn.steps.length} step${turn.steps.length === 1 ? "" : "s"}`}
              </span>
            </button>
            {showSteps && (
              <div className="flex flex-col gap-0.5 border-t border-border px-2.5 py-1.5">
                {turn.steps.map((step) => (
                  <StepView key={step.id} step={step} />
                ))}
              </div>
            )}
          </div>
        )}

        {running && turn.steps.length === 0 && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Starting...
          </span>
        )}

        {turn.status === "done" && (
          <div className="flex flex-col gap-2">
            <p className="flex items-start gap-1.5">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>{turn.summary ?? "Plugin draft ready"}</span>
            </p>
            {hasChanges(turn) && (
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="xs"
                  className="gap-1"
                  onClick={() => onViewChanges(turn)}
                >
                  <Columns2 /> View changes
                </Button>
                {canUndo && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="gap-1"
                    onClick={() => onUndo(turn)}
                  >
                    <Undo2 /> Undo
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {turn.status === "error" && <ErrorView text={turn.error ?? "Failed"} />}
      </div>
    </div>
  );
}

function ErrorView({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1.5 text-destructive">
      <p className="flex items-start gap-1.5">
        <XCircle className="mt-0.5 size-4 shrink-0" />
        <span
          className={`min-w-0 whitespace-pre-wrap wrap-break-word ${open ? "" : "line-clamp-3"}`}
        >
          {text}
        </span>
      </p>
      <div className="flex gap-2 pl-5.5">
        {text.length > 160 && (
          <Button variant="ghost" size="xs" onClick={() => setOpen((o) => !o)}>
            {open ? "Show less" : "Show all"}
          </Button>
        )}
        <Button
          variant="ghost"
          size="xs"
          className="gap-1"
          onClick={async () => {
            if (await copyToClipboard(text)) reportSuccess("Error copied");
          }}
        >
          <Copy /> Copy
        </Button>
      </div>
    </div>
  );
}

function StepView({ step }: { step: ThreadStep }) {
  const [open, setOpen] = useState(false);
  const tool = step.tool;

  if (!tool) {
    return (
      <p
        className={`py-0.5 text-xs wrap-break-word ${
          step.kind === "correction"
            ? "text-destructive"
            : "text-muted-foreground"
        }`}
      >
        {step.text}
      </p>
    );
  }

  const Icon = /search/i.test(tool.name) ? Search : Wrench;
  const detail = describeToolInput(tool.input);
  return (
    <div className="py-0.5 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 text-left text-muted-foreground hover:text-foreground"
      >
        {tool.status === "running" ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
        ) : tool.status === "ok" ? (
          <Icon className="size-3.5 shrink-0" />
        ) : (
          <XCircle className="size-3.5 shrink-0 text-destructive" />
        )}
        <span className="font-mono">{tool.name}</span>
        {detail && <span className="min-w-0 flex-1 truncate">{detail}</span>}
      </button>
      {open && (
        <pre className="mt-1 max-h-48 overflow-auto rounded border border-border p-2 font-mono whitespace-pre-wrap wrap-break-word select-text">
          {JSON.stringify(tool.input, null, 2)}
          {tool.output ? `\n\n${tool.output}` : ""}
        </pre>
      )}
    </div>
  );
}
