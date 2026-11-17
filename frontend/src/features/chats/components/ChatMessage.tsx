import { memo, useEffect, useState } from "react";
import {
  CheckIcon,
  CopyIcon,
  GitBranchIcon,
  GitBranchPlusIcon,
  ListTreeIcon,
  OctagonXIcon,
  RotateCcwIcon,
} from "lucide-react";
import { Button } from "../../../components/ui/button.tsx";
import type { Message } from "../types.ts";
import { MessageMarkdown } from "./MessageMarkdown.tsx";
import { StepsPanel } from "./StepsPanel.tsx";
import { MessageUsageLine } from "./MessageUsageLine.tsx";
import { AttachmentsList } from "./AttachmentsList.tsx";
import { ModelSuggestionFooter } from "./ModelSuggestionFooter.tsx";
import { useChats } from "../ChatsContext.tsx";
import { reportError, reportSuccess } from "@/lib/toastManager";
import { cn } from "@/lib/utils";

const COPIED_FEEDBACK_MS = 1500;

/** Its own row under the message, so it never sits on top of long content. */
const ACTION_BAR_CLASS =
  "flex items-center gap-0.5 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100 has-data-open:opacity-100 pointer-coarse:opacity-100";
const ACTION_BUTTON_CLASS = "text-muted-foreground hover:text-foreground";

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      reportError(["Could not copy the message."]);
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={ACTION_BUTTON_CLASS}
      title={copied ? "Copied" : "Copy message"}
      onClick={handleCopy}
    >
      {copied ? (
        <CheckIcon className="size-3.5" />
      ) : (
        <CopyIcon className="size-3.5" />
      )}
    </Button>
  );
}

/** Until the stream reports the stored id, a new message only has a temporary one. */
function isStored(messageId: string) {
  return /^\d+$/.test(messageId);
}

/**
 * Forks after an answer to continue from it, or, with `onBranched`, before a
 * question of yours so you can send another version of it.
 */
function ForkButton({
  messageId,
  onBranched,
}: {
  messageId: string;
  onBranched?: () => void;
}) {
  const { activeChatId, forkChat } = useChats();
  const [isForking, setIsForking] = useState(false);
  const branching = !!onBranched;
  const stored = isStored(messageId);

  async function handleFork() {
    if (!activeChatId || isForking || !stored) return;
    setIsForking(true);
    try {
      await forkChat(activeChatId, messageId, branching);
      if (onBranched) {
        onBranched();
        reportSuccess("Chat branched", "Edit your message and send it.");
      } else {
        reportSuccess("Chat forked", "Continuing from this message in a new chat.");
      }
    } catch (error) {
      reportError([
        error instanceof Error ? error.message : "Could not fork the chat.",
      ]);
    } finally {
      setIsForking(false);
    }
  }

  const title = !stored
    ? "Available once the message is saved"
    : branching
      ? "Branch here and edit"
      : "Fork from here";

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={ACTION_BUTTON_CLASS}
      title={title}
      aria-label={title}
      disabled={isForking || !stored}
      onClick={handleFork}
    >
      {branching ? (
        <GitBranchPlusIcon className="size-3.5" />
      ) : (
        <GitBranchIcon className="size-3.5" />
      )}
    </Button>
  );
}

export const ChatMessage = memo(function ChatMessage({
  message,
  isLast = false,
  onReuse,
}: {
  message: Message;
  /** The model suggestion only makes sense under the latest answer */
  isLast?: boolean;
  /** Puts a user message, with its files, back in the input to send again */
  onReuse?: (message: Message) => void;
}) {
  const isAgent = message.role === "agent";
  const [stepsOpen, setStepsOpen] = useState(false);

  if (isAgent) {
    return (
      <div className="group/message w-full">
        <div
          className={`text-sm ${
            message.isError
              ? "text-destructive font-mono"
              : "text-foreground leading-relaxed"
          }`}
        >
          {message.isError ? (
            message.content
          ) : (
            <MessageMarkdown content={message.content} />
          )}
        </div>
        {!!message.attachments?.length && (
          <AttachmentsList attachments={message.attachments} className="mt-2" />
        )}
        {isLast && !message.isError && !message.wasStopped && message.modelSuggestion && (
          <ModelSuggestionFooter suggestion={message.modelSuggestion} />
        )}
        {message.wasStopped && (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <OctagonXIcon className="size-3.5 shrink-0" />
            <span>Execution stopped.</span>
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground">
          <span>{formatTime(message.timestamp)}</span>
          {!!message.usedTools?.length && (
            <span>· used {message.usedTools.join(", ")}</span>
          )}
          <div className={cn(ACTION_BAR_CLASS, "-my-1")}>
            <CopyButton text={message.content} />
            <ForkButton messageId={message.id} />
            {!!message.steps?.length && (
              <Button
                variant="ghost"
                size="icon-sm"
                className={ACTION_BUTTON_CLASS}
                title="View steps"
                onClick={() => setStepsOpen(true)}
              >
                <ListTreeIcon className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
        {!message.isError && message.usage !== undefined && (
          <MessageUsageLine usage={message.usage} />
        )}
        {!!message.steps?.length && (
          <StepsPanel
            steps={message.steps}
            thinkingRuns={message.thinkingRuns ?? []}
            open={stepsOpen}
            onOpenChange={setStepsOpen}
          />
        )}
      </div>
    );
  }

  return (
    <div className="group/message flex w-full flex-col items-end gap-1">
      <div className="max-w-[75%] rounded-2xl bg-card border border-border px-5 py-3 text-sm text-foreground whitespace-pre-wrap break-words">
        {!!message.attachments?.length && (
          <AttachmentsList
            attachments={message.attachments}
            className="mb-2"
          />
        )}
        {message.content}
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground justify-end">
          <span>{formatTime(message.timestamp)}</span>
        </div>
      </div>
      <div className={ACTION_BAR_CLASS}>
        {onReuse && (
          <Button
            variant="ghost"
            size="icon-sm"
            className={ACTION_BUTTON_CLASS}
            title="Reuse in the input"
            onClick={() => onReuse(message)}
          >
            <RotateCcwIcon className="size-3.5" />
          </Button>
        )}
        <CopyButton text={message.content} />
        {onReuse && (
          <ForkButton
            messageId={message.id}
            onBranched={() => onReuse(message)}
          />
        )}
      </div>
    </div>
  );
});
