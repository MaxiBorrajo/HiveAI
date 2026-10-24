import { useEffect, useRef, useState } from "react";
import { GaugeIcon } from "lucide-react";
import { Button } from "../../../components/ui/button.tsx";
import { ConversationUsagePanel } from "./ConversationUsagePanel.tsx";
import { ScrollArea } from "../../../components/ui/scroll-area.tsx";
import { ChatInput } from "./ChatInput.tsx";
import { ChatMessage } from "./ChatMessage.tsx";
import { Logo } from "../../../components/Logo.tsx";
import { InteractionDialog } from "../../interactions/components/InteractionDialog.tsx";
import { formatDuration } from "@/lib/formatUsage";
import type { ChatStep } from "../types.ts";
import type { LiveToolCall } from "../api/sendMessage.ts";
import type { AttachmentDto } from "../api/attachments.ts";
import { useChatSession } from "../hooks/useChatSession.ts";
import { useChats } from "../ChatsContext.tsx";

function ChatDisclaimer({ className }: { className?: string }) {
  return (
    <p className={className ?? "text-center text-xs text-muted-foreground"}>
      HiveAI can make mistakes. Consider verifying important information.
    </p>
  );
}

function statusLabel(
  phase: "processing" | "loading_model",
  text: string,
  liveSteps: ChatStep[],
  toolsRunning: boolean,
) {
  if (phase === "loading_model") return "Loading the model into memory...";
  if (toolsRunning) return "Waiting for the tools...";
  if (text) return "Reasoning...";
  const last = liveSteps[liveSteps.length - 1];
  if (last) return "Working on the next step...";
  return "Processing your message...";
}

const MAX_ARG_LENGTH = 80;

function formatArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([key, value]) => {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      const clipped =
        text.length > MAX_ARG_LENGTH
          ? `${text.slice(0, MAX_ARG_LENGTH)}…`
          : text;
      return `${key}: ${clipped}`;
    })
    .join(", ");
}

function ThinkingIndicator({
  text,
  phase,
  liveSteps,
  liveTools,
}: {
  text: string;
  phase: "processing" | "loading_model";
  liveSteps: ChatStep[];
  liveTools: LiveToolCall[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {liveSteps.map((step, index) => (
        <div key={index} className="flex items-baseline gap-2 text-xs">
          <span className="shrink-0 text-muted-foreground">
            {step.node}
            {step.label !== step.node && ` · ${step.label}`}
          </span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground/70">
            {step.summary}
          </span>
          <span className="shrink-0 tabular-nums text-muted-foreground/70">
            {formatDuration(step.durationMs)}
          </span>
        </div>
      ))}
      {liveTools.map((call, index) => (
        <div
          key={index}
          className="flex items-baseline gap-2 font-mono text-xs"
        >
          <span className="shrink-0 animate-pulse text-muted-foreground">
            Running {call.name}
          </span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground/70">
            {formatArgs(call.args)}
          </span>
        </div>
      ))}
      <span className="animate-pulse text-xs text-muted-foreground">
        {statusLabel(phase, text, liveSteps, liveTools.length > 0)}
      </span>
      {text && (
        <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-xs italic text-muted-foreground">
          {text}
        </p>
      )}
    </div>
  );
}

export function Chat() {
  const {
    messages,
    isThinking,
    isBusy,
    thinkingText,
    phase,
    liveSteps,
    liveTools,
    conversationUsage,
    send,
    stop,
  } = useChatSession();
  const { activeChatId } = useChats();
  const [input, setInput] = useState("");
  const [usageOpen, setUsageOpen] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentDto[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking, thinkingText, liveSteps]);

  async function handleSend() {
    const content = input.trim();
    await send(
      content,
      () => {
        setInput("");
        setAttachments([]);
      },
      attachments,
      () => {
        setInput(content);
        setAttachments(attachments);
      },
    );
  }

  const handleStop = stop;
  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-1 min-w-0 h-screen bg-background text-foreground font-sans overflow-hidden">
      <div className="flex flex-1 flex-col min-w-0 min-h-0 relative w-full">
        {isEmpty ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6">
            <div className="flex flex-col items-center gap-6 w-full max-w-3xl">
              <div className="flex items-center justify-center gap-2">
                <Logo size={50} />
                <h1 className="text-display text-5xl font-medium">
                  HiveAI
                </h1>
              </div>
              <InteractionDialog />
              <ChatInput
                input={input}
                setInput={setInput}
                isThinking={isBusy}
                handleSend={handleSend}
                handleStop={handleStop}
                isEmpty
                chatId={activeChatId}
                attachments={attachments}
                onAttachmentsChange={setAttachments}
              />
              <ChatDisclaimer className="text-center text-xs text-muted-foreground mt-2" />
            </div>
          </div>
        ) : (
          <>
            <div className="flex justify-end border-b border-border px-6 py-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={() => setUsageOpen(true)}
              >
                <GaugeIcon className="size-3.5" />
                Usage
              </Button>
            </div>
            <ConversationUsagePanel
              usage={conversationUsage}
              open={usageOpen}
              onOpenChange={setUsageOpen}
            />
            <ScrollArea className="flex-1 min-h-0 **:data-[slot=scroll-area-thumb]:bg-muted-foreground/30 **:data-[slot=scroll-area-thumb]:hover:bg-muted-foreground/50 **:data-[slot=scroll-area-thumb]:transition-colors">
              <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
                {messages.map((message) => (
                  <ChatMessage key={message.id} message={message} />
                ))}

                {isThinking && (
                  <ThinkingIndicator
                    text={thinkingText}
                    phase={phase}
                    liveSteps={liveSteps}
                    liveTools={liveTools}
                  />
                )}

                <div ref={bottomRef} />
              </div>
            </ScrollArea>

            <div className="px-6 py-4 pb-6 bg-background">
              <div className="mx-auto flex max-w-3xl flex-col items-center gap-2">
                <InteractionDialog />
                <ChatInput
                  input={input}
                  setInput={setInput}
                  isThinking={isBusy}
                  handleSend={handleSend}
                  handleStop={handleStop}
                  chatId={activeChatId}
                  attachments={attachments}
                  onAttachmentsChange={setAttachments}
                />
                <ChatDisclaimer />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
