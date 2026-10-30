import { memo, useState } from "react";
import { GitBranchIcon, ListTreeIcon, OctagonXIcon } from "lucide-react";
import { Button } from "../../../components/ui/button.tsx";
import type { Message } from "../types.ts";
import { MessageMarkdown } from "./MessageMarkdown.tsx";
import { StepsPanel } from "./StepsPanel.tsx";
import { MessageUsageLine } from "./MessageUsageLine.tsx";
import { AttachmentsList } from "./AttachmentsList.tsx";
import { useChats } from "../ChatsContext.tsx";
import { reportError, reportSuccess } from "@/lib/toastManager";

function ForkButton({
  messageId,
  className,
}: {
  messageId: string;
  className?: string;
}) {
  const { activeChatId, forkChat } = useChats();
  const [isForking, setIsForking] = useState(false);

  async function handleFork() {
    if (!activeChatId || isForking) return;
    setIsForking(true);
    try {
      await forkChat(activeChatId, messageId);
      reportSuccess("Chat forked", "Continuing from this message in a new chat.");
    } catch (error) {
      reportError([
        error instanceof Error ? error.message : "Could not fork the chat.",
      ]);
    } finally {
      setIsForking(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      title="Fork from here"
      disabled={isForking}
      onClick={handleFork}
    >
      <GitBranchIcon className="size-3.5" />
    </Button>
  );
}

export const ChatMessage = memo(function ChatMessage({
  message,
}: {
  message: Message;
}) {
  const isAgent = message.role === "agent";
  const [stepsOpen, setStepsOpen] = useState(false);

  if (isAgent) {
    return (
      <div className="group/message w-full relative">
        <div className="absolute -top-1 right-0 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/message:opacity-100 has-data-open:opacity-100">
          <ForkButton messageId={message.id} />
          {!!message.steps?.length && (
            <Button
              variant="ghost"
              size="icon-sm"
              title="View steps"
              onClick={() => setStepsOpen(true)}
            >
              <ListTreeIcon className="size-3.5" />
            </Button>
          )}
        </div>
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
        {message.wasStopped && (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <OctagonXIcon className="size-3.5 shrink-0" />
            <span>Execution stopped.</span>
          </div>
        )}
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground justify-start">
          <span>
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
          {!!message.usedTools?.length && (
            <span>· used {message.usedTools.join(", ")}</span>
          )}
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
    <div className="group/message flex w-full justify-end items-start gap-1">
      <ForkButton
        messageId={message.id}
        className="mt-3 shrink-0 opacity-0 transition-opacity group-hover/message:opacity-100"
      />
      <div className="max-w-[75%] rounded-2xl bg-card border border-border px-5 py-3 text-sm text-foreground whitespace-pre-wrap break-words">
        {!!message.attachments?.length && (
          <AttachmentsList
            attachments={message.attachments}
            className="mb-2"
          />
        )}
        {message.content}
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground justify-end">
          <span>
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        </div>
      </div>
    </div>
  );
});
