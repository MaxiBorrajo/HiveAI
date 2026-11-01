import { useEffect, useRef, useState } from "react";
import { SendIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InteractionDialog } from "@/features/interactions/components/InteractionDialog";
import { MessageMarkdown } from "@/features/chats/components/MessageMarkdown";
import { getErrorMessage } from "@/lib/errors";
import { reportError } from "@/lib/toastManager";
import type { ModelChoice } from "@/features/models/lib/modelChoices";
import { getRubric, saveRubric } from "../../api/rubric";
import { gradeRuns } from "../../api/gradeRuns";
import { judgeChat } from "../../api/judgeChat";
import type { Rubric, RunSummary } from "../../types";
import { JudgeModelSelect } from "./JudgeModelSelect";

const judgeStorageKey = (executionId: string) => `hiveai.judge.${executionId}`;

function loadJudge(executionId: string): ModelChoice | null {
  try {
    const raw = localStorage.getItem(judgeStorageKey(executionId));
    return raw ? (JSON.parse(raw) as ModelChoice) : null;
  } catch {
    return null;
  }
}

function rememberJudge(executionId: string, choice: ModelChoice) {
  try {
    localStorage.setItem(judgeStorageKey(executionId), JSON.stringify(choice));
  } catch {
    // The choice just isn't remembered.
  }
}

interface ChatLine {
  role: "user" | "judge";
  text: string;
  tools?: string[];
}

function JudgeChat({
  executionId,
  runs,
  judge,
}: {
  executionId: string;
  runs: RunSummary[];
  judge: ModelChoice | null;
}) {
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const chatId = useRef<number | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const send = async () => {
    const message = draft.trim();
    if (!message || !judge || busy) return;
    setDraft("");
    setBusy(true);
    setLines((l) => [...l, { role: "user", text: message }, { role: "judge", text: "" }]);
    const patchLast = (fn: (line: ChatLine) => ChatLine) =>
      setLines((l) => [...l.slice(0, -1), fn(l[l.length - 1])]);
    const controller = new AbortController();
    abort.current = controller;
    try {
      await judgeChat(
        executionId,
        { message, chatId: chatId.current, historyIds: runs.map((r) => r.historyId), judge },
        {
          onChatCreated: (id) => (chatId.current = id),
          onToolCalls: (names) =>
            patchLast((line) => ({ ...line, tools: [...(line.tools ?? []), ...names] })),
          onToken: (text) => patchLast((line) => ({ ...line, text: line.text + text })),
          onDone: (content) => patchLast((line) => ({ ...line, text: content })),
          onError: (m) => patchLast((line) => ({ ...line, text: `Error: ${m}` })),
        },
        controller.signal,
      );
    } catch (e) {
      if (!controller.signal.aborted) {
        patchLast((line) => ({ ...line, text: `Error: ${getErrorMessage(e, "The judge did not answer.")}` }));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Ask the judge about these runs. It can use your active plugins, for
        example to look up the price of a model.
      </p>
      <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
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
      </ul>
      <div className="flex items-end gap-2">
        <Textarea
          value={draft}
          rows={2}
          placeholder={judge ? "Ask the judge…" : "Pick a judge model first"}
          disabled={!judge}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {busy ? (
          <Button size="icon" variant="outline" onClick={() => abort.current?.abort()}>
            <SquareIcon />
            <span className="sr-only">Stop</span>
          </Button>
        ) : (
          <Button size="icon" disabled={!judge || !draft.trim()} onClick={() => void send()}>
            <SendIcon />
            <span className="sr-only">Send</span>
          </Button>
        )}
      </div>
      <InteractionDialog />
    </div>
  );
}

export function JudgePanel({
  executionId,
  runs,
  onGraded,
}: {
  executionId: string;
  runs: RunSummary[];
  onGraded: () => void;
}) {
  const [rubric, setRubric] = useState<Rubric | null>(null);
  const [text, setText] = useState("");
  const [reference, setReference] = useState("");
  const [judge, setJudge] = useState<ModelChoice | null>(() => loadJudge(executionId));
  const [grading, setGrading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getRubric(executionId)
      .then(({ data }) => {
        if (cancelled || !data?.rubric) return;
        setRubric(data.rubric);
        setText(data.rubric.rubric);
        setReference(data.rubric.reference ?? "");
      })
      .catch((e) => {
        if (!cancelled) setLoadError(getErrorMessage(e, "Could not load the rubric."));
      });
    return () => {
      cancelled = true;
    };
  }, [executionId]);

  const dirty =
    text.trim() !== (rubric?.rubric ?? "") ||
    reference.trim() !== (rubric?.reference ?? "");

  const grade = async () => {
    if (!judge || !text.trim()) return;
    setGrading(true);
    try {
      let current = rubric;
      if (!current || dirty) {
        const saved = await saveRubric(executionId, text, reference);
        current = saved.data?.rubric ?? null;
        setRubric(current);
      }
      if (!current) return;
      const { data } = await gradeRuns(
        executionId,
        runs.map((r) => r.historyId),
        judge,
        current.id,
      );
      const failed = data?.grades.filter((g) => g.status === "failed").length ?? 0;
      if (failed > 0) {
        reportError([`The judge could not grade ${failed} run(s); they stay unevaluated.`]);
      }
      onGraded();
    } catch (e) {
      reportError([getErrorMessage(e, "Could not grade the runs.")]);
    } finally {
      setGrading(false);
    }
  };

  const pickJudge = (choice: ModelChoice) => {
    setJudge(choice);
    rememberJudge(executionId, choice);
  };

  return (
    <Tabs defaultValue="grade">
      <TabsList>
        <TabsTrigger value="grade">Grade with a judge</TabsTrigger>
        <TabsTrigger value="chat">Ask the judge</TabsTrigger>
      </TabsList>
      <div className="mt-3 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Judge model</span>
          <JudgeModelSelect value={judge} onChange={pickJudge} disabled={grading} />
        </div>
        <TabsContent value="grade" className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Optional. The rubric belongs to this execution and is versioned
            {rubric ? ` (current: v${rubric.version}${dirty ? ", edited" : ""})` : ""}.
          </p>
          {loadError && <p className="text-xs text-destructive">{loadError}</p>}
          <Textarea
            value={text}
            rows={4}
            placeholder="What makes a good result? e.g. “Answers the question, cites sources, under 200 words.”"
            onChange={(e) => setText(e.target.value)}
            disabled={grading}
          />
          <Input
            value={reference}
            placeholder="Reference answer (optional)"
            onChange={(e) => setReference(e.target.value)}
            disabled={grading}
          />
          <div className="flex justify-end">
            <Button disabled={!judge || !text.trim() || grading} onClick={() => void grade()}>
              {grading ? "Grading…" : `Grade ${runs.length} runs`}
            </Button>
          </div>
        </TabsContent>
        <TabsContent value="chat">
          <JudgeChat executionId={executionId} runs={runs} judge={judge} />
        </TabsContent>
      </div>
    </Tabs>
  );
}
