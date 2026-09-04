import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Logo } from "@/components/logo/Logo";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PluginList } from "@/components/PluginList";
import { InteractionDialog } from "@/components/Chat/InteractionDialog";
import { sendMessage } from "@/lib/send-message";
import type { Message } from "@/types/chat";

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
    setThinkingText("");

    const agentMessageId = crypto.randomUUID();
    let streamStarted = false;

    try {
      await sendMessage(content, {
        onThinking: () => {},
        onThinkingDelta: (delta) => {
          setThinkingText((prev) => prev + delta);
        },
        onToken: (token) => {
          if (!streamStarted) {
            streamStarted = true;
            setIsThinking(false);
            setThinkingText("");
            setMessages((prev) => [
              ...prev,
              {
                id: agentMessageId,
                role: "agent",
                content: token,
                timestamp: Date.now(),
              },
            ]);
            return;
          }

          setMessages((prev) =>
            prev.map((message) =>
              message.id === agentMessageId
                ? { ...message, content: message.content + token }
                : message,
            ),
          );
        },
        onDone: (finalContent, usedTools, steps) => {
          setMessages((prev) =>
            prev.map((message) =>
              message.id === agentMessageId
                ? { ...message, content: finalContent, usedTools, steps }
                : message,
            ),
          );
        },
        onError: (errorMessage) => {
          throw new Error(errorMessage);
        },
      });
    } catch (error) {
      setMessages((prev) => {
        const withoutPartial = prev.filter((m) => m.id !== agentMessageId);
        return [
          ...withoutPartial,
          {
            id: crypto.randomUUID(),
            role: "agent",
            content:
              error instanceof Error
                ? `No se pudo obtener respuesta: ${error.message}`
                : "No se pudo obtener respuesta del agente.",
            isError: true,
            timestamp: Date.now(),
          },
        ];
      });
    } finally {
      setIsThinking(false);
      setThinkingText("");
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex h-screen bg-background text-foreground font-sans overflow-hidden">
      <div className="flex flex-1 flex-col min-w-0 min-h-0">
        <header className="flex h-16 items-center gap-3 border-b border-border px-6">
          <Logo size={28} withWordmark />
        </header>

        <ScrollArea className="flex-1 min-h-0 **:data-[slot=scroll-area-thumb]:bg-muted-foreground/30 **:data-[slot=scroll-area-thumb]:hover:bg-muted-foreground/50 **:data-[slot=scroll-area-thumb]:transition-colors">
          <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
            {messages.length === 0 && (
              <p className="text-muted-foreground text-sm">
                Preguntale algo a HiveQueen para empezar.
              </p>
            )}

            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}

            {isThinking && (
              <div className="flex items-start gap-3">
                <Avatar>
                  <AvatarFallback className="bg-primary/20 text-primary">
                    HQ
                  </AvatarFallback>
                </Avatar>
                <div className="max-w-[75%] rounded-lg border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
                  <span className="animate-pulse">Pensando...</span>
                  {thinkingText && (
                    <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap text-xs italic opacity-70">
                      {thinkingText}
                    </p>
                  )}
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        <div className="border-t border-border px-6 py-4">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Escribí un mensaje al agente..."
              className="resize-none text-base"
              rows={2}
            />
            <Button
              onClick={handleSend}
              disabled={isThinking || !input.trim()}
            >
              Enviar
            </Button>
          </div>
        </div>
      </div>

      <PluginList />
      <InteractionDialog />
    </div>
  );
}

function ChatMessage({ message }: { message: Message }) {
  const isAgent = message.role === "agent";

  const bubble = (
    <div
      className={`max-w-[75%] rounded-lg px-4 py-2 text-sm ${
        message.isError
          ? "bg-destructive/10 text-destructive border border-destructive/40"
          : isAgent
            ? "bg-card text-card-foreground border border-border"
            : "bg-primary/10 text-foreground"
      }`}
    >
      {isAgent && !message.isError ? (
        <MessageMarkdown content={message.content} />
      ) : (
        message.content
      )}
      <div
        className={`mt-1 flex items-center gap-1.5 text-[10px] opacity-60 ${isAgent ? "justify-start" : "justify-end"}`}
      >
        <span>
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
        {!!message.usedTools?.length && (
          <span>· usó {message.usedTools.join(", ")}</span>
        )}
      </div>
      {!!message.steps?.length && <StepsDisclosure steps={message.steps} />}
    </div>
  );

  const avatar = (
    <Avatar>
      <AvatarFallback
        className={
          isAgent
            ? "bg-primary/20 text-primary"
            : "bg-secondary text-secondary-foreground"
        }
      >
        {isAgent ? "HQ" : "Vos"}
      </AvatarFallback>
    </Avatar>
  );

  return (
    <div
      className={`flex items-center gap-3 ${isAgent ? "flex-row" : "flex-row-reverse"}`}
    >
      {avatar}
      {bubble}
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

function StepsDisclosure({ steps }: { steps: NonNullable<Message["steps"]> }) {
  const totalMs = steps.reduce((sum, step) => sum + step.durationMs, 0);

  return (
    <details className="mt-1.5 text-[10px] opacity-60">
      <summary className="cursor-pointer select-none hover:opacity-100">
        Ver pasos ({totalMs < 1000 ? `${totalMs.toFixed(0)}ms` : `${(totalMs / 1000).toFixed(1)}s`})
      </summary>
      <ul className="mt-1.5 space-y-1 border-l border-border pl-2">
        {steps.map((step, index) => (
          <li key={index}>
            <span className="font-medium">{step.node}</span>
            {step.label !== step.node && <span> · {step.label}</span>}
            <span> · {step.durationMs.toFixed(0)}ms</span>
            <div className="opacity-80">{step.summary}</div>
          </li>
        ))}
      </ul>
    </details>
  );
}
