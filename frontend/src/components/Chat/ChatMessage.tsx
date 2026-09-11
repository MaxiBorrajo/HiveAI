import { memo, useState } from "react";
import { ListTreeIcon } from "lucide-react";
import { Button } from "../ui/button.tsx";
import type { Message } from "../../types/chat.ts";
import { MessageMarkdown } from "./MessageMarkdown.tsx";
import { StepsPanel } from "./StepsPanel.tsx";

export const ChatMessage = memo(function ChatMessage({ message }: { message: Message }) {
  const isAgent = message.role === "agent";
  const [stepsOpen, setStepsOpen] = useState(false);

  if (isAgent) {
    return (
      <div className="group/message w-full relative">
        {!!message.steps?.length && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute -top-1 right-0 opacity-0 transition-opacity group-hover/message:opacity-100 data-open:opacity-100"
            title="Ver pasos"
            onClick={() => setStepsOpen(true)}
          >
            <ListTreeIcon className="size-3.5" />
          </Button>
        )}
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
        <div className="mt-1 flex items-center gap-1.5 text-[10px] opacity-50 justify-start">
          <span>
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
          {!!message.usedTools?.length && (
            <span>· se usó {message.usedTools.join(", ")}</span>
          )}
        </div>
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
    <div className="flex w-full justify-end">
      <div className="max-w-[75%] rounded-2xl bg-card border border-border px-5 py-3 text-sm text-foreground whitespace-pre-wrap break-words">
        {message.content}
        <div className="mt-1 flex items-center gap-1.5 text-[10px] opacity-40 justify-end">
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
