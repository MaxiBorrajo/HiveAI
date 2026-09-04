import { useEffect, useRef, useState } from "react";
import { ScrollArea } from "../ui/scroll-area.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { sendMessage } from "../../lib/send-message.ts";
import type { Message } from "../../types/chat.ts";
import { ChatInput } from "./ChatInput.tsx";
import { Logo } from "../Logo.tsx";

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingText, setThinkingText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking, thinkingText]);

  async function handleSend() {
    const content = input.trim();
    if (!content || isThinking) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsThinking(true);

    try {
      const reply = await sendMessage(content);
      setMessages((prev) => [...prev, reply]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "agent",
          content:
            error instanceof Error
              ? `Could not get a response: ${error.message}`
              : "Could not get a response from the agent.",
          isError: true,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsThinking(false);
      setThinkingText("");
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="flex h-screen bg-background text-foreground font-sans overflow-hidden">
      <div className="flex flex-1 flex-col min-w-0 min-h-0 relative w-full">
        {isEmpty ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6">
            <div className="flex flex-col items-center gap-6 w-full max-w-3xl">
              <div className="flex items-center justify-center gap-3">
                <Logo size={40} />
                <h1 className="text-display text-3xl font-medium">
                  Welcome to the hive
                </h1>
              </div>
              <ChatInput
                input={input}
                setInput={setInput}
                isThinking={isThinking}
                handleSend={handleSend}
              />
              <p className="text-center text-xs text-muted-foreground mt-2">
                HiveQueen can make mistakes. Consider verifying important
                information.
              </p>
            </div>
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1 min-h-0 **:data-[slot=scroll-area-thumb]:bg-muted-foreground/30 **:data-[slot=scroll-area-thumb]:hover:bg-muted-foreground/50 **:data-[slot=scroll-area-thumb]:transition-colors">
              <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
                {messages.map((message) => (
                  <ChatMessage key={message.id} message={message} />
                ))}

                {isThinking && (
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-4 w-48" />
                  </div>
                )}

                <div ref={bottomRef} />
              </div>
            </ScrollArea>

            <div className="px-6 py-4 pb-6 bg-background">
              <div className="mx-auto flex max-w-3xl flex-col items-center gap-2">
                <ChatInput
                  input={input}
                  setInput={setInput}
                  isThinking={isThinking}
                  handleSend={handleSend}
                />
                <p className="text-center text-xs text-muted-foreground">
                  HiveQueen can make mistakes. Consider verifying important
                  information.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ChatMessage({ message }: { message: Message }) {
  const isAgent = message.role === "agent";

  if (isAgent) {
    return (
      <div className="w-full">
        <div
          className={`text-sm ${
            message.isError
              ? "text-destructive font-mono"
              : "text-foreground leading-relaxed"
          }`}
        >
          {message.content}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[10px] opacity-50 justify-start">
          <span>
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {!!message.usedTools?.length && (
            <span>· used {message.usedTools.join(", ")}</span>
          )}
        </div>
      </div>
    );
  }

  // User Message
  return (
    <div className="flex w-full justify-end">
      <div className="max-w-[75%] rounded-2xl bg-card border border-border px-5 py-3 text-sm text-foreground">
        {message.content}
        <div className="mt-1 flex items-center gap-1.5 text-[10px] opacity-40 justify-end">
          <span>
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      </div>
    </div>
  );
}

function MessageMarkdown({ content }: { content: string }) {
  return (
    <div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="my-1.5 leading-relaxed">{children}</p>,
          ul: ({ children }) => (
            <ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>
          ),
          li: ({ children }) => <li>{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          code: ({ children, className }) =>
            className ? (
              <code className="font-mono text-xs">{children}</code>
            ) : (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                {children}
              </code>
            ),
          pre: ({ children }) => (
            <pre className="my-1.5 overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">
              {children}
            </pre>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:opacity-80"
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
