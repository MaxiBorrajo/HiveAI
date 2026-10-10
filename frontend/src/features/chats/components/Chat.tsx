import { useEffect, useRef, useState } from "react";
import { GaugeIcon } from "lucide-react";
import { Button } from "../../../components/ui/button.tsx";
import { ConversationUsagePanel } from "./ConversationUsagePanel.tsx";
import { ScrollArea } from "../../../components/ui/scroll-area.tsx";
import { Skeleton } from "../../../components/ui/skeleton.tsx";
import { ChatInput } from "./ChatInput.tsx";
import { ChatMessage } from "./ChatMessage.tsx";
import { Logo } from "../../../components/Logo.tsx";
import { InteractionDialog } from "../../interactions/components/InteractionDialog.tsx";
import { useChatSession } from "../hooks/useChatSession.ts";

function ChatDisclaimer({ className }: { className?: string }) {
  return (
    <p className={className ?? "text-center text-xs text-muted-foreground"}>
      HiveAI can make mistakes. Consider verifying important information.
    </p>
  );
}

function ThinkingIndicator({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-32" />
        <span className="animate-pulse text-xs text-muted-foreground">
          Thinking...
        </span>
      </div>
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
    conversationUsage,
    send,
    stop,
  } = useChatSession();
  const [input, setInput] = useState("");
  const [usageOpen, setUsageOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking, thinkingText]);

  async function handleSend() {
    const content = input.trim();
    await send(content, () => setInput(""));
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
              <ChatInput
                input={input}
                setInput={setInput}
                isThinking={isBusy}
                handleSend={handleSend}
                handleStop={handleStop}
                isEmpty
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

                {isThinking && <ThinkingIndicator text={thinkingText} />}

                <div ref={bottomRef} />
              </div>
            </ScrollArea>

            <div className="px-6 py-4 pb-6 bg-background">
              <div className="mx-auto flex max-w-3xl flex-col items-center gap-2">
                <ChatInput
                  input={input}
                  setInput={setInput}
                  isThinking={isBusy}
                  handleSend={handleSend}
                  handleStop={handleStop}
                />
                <ChatDisclaimer />
              </div>
            </div>
          </>
        )}
      </div>
      <InteractionDialog />
    </div>
  );
}
