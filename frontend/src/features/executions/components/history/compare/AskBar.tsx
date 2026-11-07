import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { ChatInput } from "@/features/chats/components/ChatInput";
import { InteractionDialog } from "@/features/interactions/components/InteractionDialog";
import { MessageMarkdown } from "@/features/chats/components/MessageMarkdown";
import { getErrorMessage } from "@/lib/errors";
import { useModels } from "@/features/models/ModelsContext";
import { currentChoice } from "@/features/models/lib/modelChoices";
import { judgeChat, type JudgeFocus } from "../../../api/judgeChat";
import type { RunSummary } from "../../../types";

interface ChatLine {
  role: "user" | "judge";
  text: string;
  tools?: string[];
}

export const SUGGESTIONS: Record<JudgeFocus, string[]> = {
  overview: [
    "Which run was best overall?",
    "What are the main differences between the runs?",
  ],
  result: [
    "Which result do you think was better and why?",
    "Does any result have mistakes or missing parts?",
  ],
  tokens: [
    "Based on current Claude pricing, which run was more expensive?",
    "Which run used its tokens more efficiently?",
  ],
  nodes: [
    "Which nodes explain the difference between the runs?",
    "Did a model change affect the outcome?",
  ],
};

export function AskBar({
  executionId,
  runs,
  focus,
}: {
  executionId: string;
  runs: RunSummary[];
  focus: JudgeFocus;
}) {
  // Asking uses the model the user already has selected; the chat input's
  // model button changes it.
  const { current } = useModels();
  const judge = current.model ? currentChoice(current) : null;
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const chatId = useRef<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const listEnd = useRef<HTMLLIElement | null>(null);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    listEnd.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  const send = async (text = draft) => {
    const message = text.trim();
    if (!message || !judge || busy) return;
    setDraft("");
    setCollapsed(false);
    setBusy(true);
    setLines((l) => [...l, { role: "user", text: message }, { role: "judge", text: "" }]);
    const patchLast = (fn: (line: ChatLine) => ChatLine) =>
      setLines((l) => [...l.slice(0, -1), fn(l[l.length - 1])]);
    const controller = new AbortController();
    abort.current = controller;
    try {
      await judgeChat(
        executionId,
        {
          message,
          chatId: chatId.current,
          historyIds: runs.map((r) => r.historyId),
          judge,
          focus,
        },
        {
          onChatCreated: (id) => (chatId.current = id),
          onToolCalls: (names) =>
            patchLast((line) => ({ ...line, tools: [...(line.tools ?? []), ...names] })),
          onToken: (t) => patchLast((line) => ({ ...line, text: line.text + t })),
          onDone: (content) => patchLast((line) => ({ ...line, text: content })),
          onError: (m) => patchLast((line) => ({ ...line, text: `Error: ${m}` })),
        },
        controller.signal,
      );
    } catch (e) {
      if (!controller.signal.aborted) {
        patchLast((line) => ({
          ...line,
          text: `Error: ${getErrorMessage(e, "The judge did not answer.")}`,
        }));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      {lines.length > 0 && (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            className="flex w-fit items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground"
            onClick={() => setCollapsed((c) => !c)}
          >
            <ChevronDownIcon
              className={`size-3 transition-transform ${collapsed ? "-rotate-90" : ""}`}
            />
            {collapsed ? "Show conversation" : "Hide conversation"}
          </button>
          {!collapsed && (
            <ul className="flex max-h-60 flex-col gap-2 overflow-y-auto">
              {lines.map((line, i) => (
                <li
                  key={i}
                  className={
                    line.role === "user"
                      ? "self-end rounded-md bg-muted px-3 py-2 text-sm"
                      : "rounded-md border border-border px-3 py-2 text-sm"
                  }
                >
                  {line.tools && line.tools.length > 0 && (
                    <p className="mb-1 font-mono text-[10px] text-muted-foreground">
                      used: {[...new Set(line.tools)].join(", ")}
                    </p>
                  )}
                  {line.role === "judge" && !line.text ? (
                    <span className="text-xs text-muted-foreground">Thinking…</span>
                  ) : (
                    <MessageMarkdown content={line.text} />
                  )}
                </li>
              ))}
              <li ref={listEnd} aria-hidden />
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {SUGGESTIONS[focus].map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={!judge || busy}
            className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            onClick={() => void send(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>

      <ChatInput
        className="max-w-none"
        input={draft}
        setInput={setDraft}
        isThinking={busy}
        handleSend={() => void send()}
        handleStop={() => abort.current?.abort()}
        hidePluginsAndModes
        placeholder="Ask the judge about this tab… it can look up prices with your plugins"
      />
      <InteractionDialog />
    </div>
  );
}
