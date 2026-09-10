import { memo, useEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { ScrollArea } from "../ui/scroll-area.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { sendMessage } from "../../lib/chats/sendMessage.ts";
import { getChatMessages } from "../../lib/chats/getChatMessages.ts";
import { reportError } from "../../lib/toastManager.ts";
import type { Message } from "../../types/chat.ts";
import { ChatInput } from "./ChatInput.tsx";
import { Logo } from "../Logo.tsx";
import { InteractionDialog } from "./InteractionDialog.tsx";
import { useChats } from "../../context/ChatsContext.tsx";

// Slot for a chat that hasn't been assigned a real id yet (the "new chat"
// screen, before the first message's chat_created event arrives). Scoped by
// ChatsContext's newChatToken — which changes every time a fresh blank
// screen is shown — so starting a second new chat while a first one is
// still awaiting its chat_created event can't collide with it on one slot.
function newChatKey(token: string): string {
  return `__new__:${token}`;
}

interface ThinkingState {
  isThinking: boolean;
  thinkingText: string;
}

const IDLE_THINKING: ThinkingState = { isThinking: false, thinkingText: "" };

export function Chat() {
  const { activeChatId, newChatToken, onChatCreated, refreshChats, touchChat } =
    useChats();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Messages and "thinking" state are kept in maps keyed by chat id, so
  // each chat's state is fully isolated — switching chats or a background
  // response finishing can never write into the wrong chat's view.
  const [messagesByChat, setMessagesByChat] = useState<
    Record<string, Message[]>
  >({});
  const [thinkingByChat, setThinkingByChat] = useState<
    Record<string, ThinkingState>
  >({});

  // Set right when a chat is created mid-send (chat_created event), so the
  // fetch-on-select effect below doesn't immediately race the still-streaming
  // response with a server fetch that may not have the message persisted yet.
  const justCreatedChatIdRef = useRef<string | null>(null);

  const displayKey = activeChatId ?? newChatKey(newChatToken);
  const messages = messagesByChat[displayKey] ?? [];
  const { isThinking, thinkingText } = thinkingByChat[displayKey] ?? IDLE_THINKING;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking, thinkingText]);

  useEffect(() => {
    if (!activeChatId) return;

    if (justCreatedChatIdRef.current === activeChatId) {
      justCreatedChatIdRef.current = null;
      return;
    }

    let cancelled = false;
    getChatMessages(activeChatId).then(({ data }) => {
      if (cancelled || !data) return;
      setMessagesByChat((prev) => ({
        ...prev,
        [activeChatId]: data.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
          usedTools: m.metadata?.usedTools,
          steps: m.metadata?.steps,
        })),
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [activeChatId]);

  async function handleSend() {
    const content = input.trim();
    if (!content || isThinking) return;

    // The slot this send writes into. Starts as this new-chat screen's own
    // draft key (or the existing chat's id) and gets migrated to the real
    // chat id once chat_created arrives.
    const startKey = activeChatId ?? newChatKey(newChatToken);
    let key = startKey;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: Date.now(),
    };

    setMessagesByChat((prev) => ({
      ...prev,
      [key]: [...(prev[key] ?? []), userMessage],
    }));
    setInput("");
    setThinkingByChat((prev) => ({
      ...prev,
      [key]: { isThinking: true, thinkingText: "" },
    }));

    if (activeChatId) {
      touchChat(activeChatId);
    }

    const agentMessageId = crypto.randomUUID();
    let streamStarted = false;

    function appendAgentMessage(k: string, message: Message) {
      setMessagesByChat((prev) => ({
        ...prev,
        [k]: [...(prev[k] ?? []), message],
      }));
    }

    function updateAgentMessage(k: string, patch: Partial<Message>) {
      setMessagesByChat((prev) => ({
        ...prev,
        [k]: (prev[k] ?? []).map((message) =>
          message.id === agentMessageId ? { ...message, ...patch } : message,
        ),
      }));
    }

    try {
      await sendMessage(activeChatId, content, {
        onChatCreated: (chatId) => {
          justCreatedChatIdRef.current = chatId;
          setMessagesByChat((prev) => {
            const { [startKey]: draft, ...rest } = prev;
            return { ...rest, [chatId]: draft ?? [] };
          });
          setThinkingByChat((prev) => {
            const { [startKey]: draft, ...rest } = prev;
            return { ...rest, [chatId]: draft ?? { isThinking: true, thinkingText: "" } };
          });
          key = chatId;
          onChatCreated(chatId);
        },
        onThinking: () => {},
        onThinkingDelta: (delta) => {
          setThinkingByChat((prev) => ({
            ...prev,
            [key]: {
              isThinking: prev[key]?.isThinking ?? true,
              thinkingText: (prev[key]?.thinkingText ?? "") + delta,
            },
          }));
        },
        onToken: (token) => {
          if (!streamStarted) {
            streamStarted = true;
            setThinkingByChat((prev) => ({ ...prev, [key]: IDLE_THINKING }));
            appendAgentMessage(key, {
              id: agentMessageId,
              role: "agent",
              content: token,
              timestamp: Date.now(),
            });
            return;
          }

          setMessagesByChat((prev) => ({
            ...prev,
            [key]: (prev[key] ?? []).map((message) =>
              message.id === agentMessageId
                ? { ...message, content: message.content + token }
                : message,
            ),
          }));
        },
        onDone: (finalContent, usedTools, steps) => {
          updateAgentMessage(key, { content: finalContent, usedTools, steps });
          refreshChats();
        },
        onError: (errorMessage) => {
          reportError([errorMessage]);
          throw new Error(errorMessage);
        },
      });
    } catch (error) {
      setMessagesByChat((prev) => {
        const withoutPartial = (prev[key] ?? []).filter(
          (m) => m.id !== agentMessageId,
        );
        return {
          ...prev,
          [key]: [
            ...withoutPartial,
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
          ],
        };
      });
    } finally {
      setThinkingByChat((prev) => ({ ...prev, [key]: IDLE_THINKING }));
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-1 min-w-0 h-screen bg-background text-foreground font-sans overflow-hidden">
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
                isEmpty
              />
              <p className="text-center text-xs text-muted-foreground mt-2">
                HiveAI can make mistakes. Consider verifying important
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
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-4 w-32" />
                      <span className="animate-pulse text-xs text-muted-foreground">
                        Pensando...
                      </span>
                    </div>
                    {thinkingText && (
                      <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-xs italic opacity-60">
                        {thinkingText}
                      </p>
                    )}
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
                  HiveAI can make mistakes. Consider verifying important
                  information.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
      <InteractionDialog />
    </div>
  );
}

const ChatMessage = memo(function ChatMessage({ message }: { message: Message }) {
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
        {!!message.steps?.length && <StepsDisclosure steps={message.steps} />}
      </div>
    );
  }

  return (
    <div className="flex w-full justify-end">
      <div className="max-w-[75%] rounded-2xl bg-card border border-border px-5 py-3 text-sm text-foreground">
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

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mt-3 mb-1.5 text-lg font-semibold">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-3 mb-1.5 text-base font-semibold">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-2 mb-1 text-sm font-semibold">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-2 mb-1 text-sm font-semibold">{children}</h4>
  ),
  h5: ({ children }) => (
    <h5 className="mt-2 mb-1 text-sm font-semibold">{children}</h5>
  ),
  h6: ({ children }) => (
    <h6 className="mt-2 mb-1 text-sm font-semibold">{children}</h6>
  ),
  p: ({ children }) => <p className="my-1.5 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>,
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
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>
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
};

const MessageMarkdown = memo(function MessageMarkdown({
  content,
}: {
  content: string;
}) {
  return (
    <div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown components={markdownComponents}>{content}</ReactMarkdown>
    </div>
  );
});

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
