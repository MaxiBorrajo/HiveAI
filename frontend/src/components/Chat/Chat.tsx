import { useEffect, useRef, useState } from "react";
import { ScrollArea } from "../ui/scroll-area.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { sendMessage } from "../../lib/chats/sendMessage.ts";
import { getChatMessages } from "../../lib/chats/getChatMessages.ts";
import { reportError } from "../../lib/toastManager.ts";
import type { Message, ThinkingRun } from "../../types/chat.ts";
import { ChatInput } from "./ChatInput.tsx";
import { ChatMessage } from "./ChatMessage.tsx";
import { Logo } from "../Logo.tsx";
import { InteractionDialog } from "./InteractionDialog.tsx";
import { useChats } from "../../context/ChatsContext.tsx";
import { useModels } from "../../context/ModelsContext.tsx";
import {
  isWindowFocused,
  notifyChatResponse,
  requestNotificationPermission,
} from "../../lib/notify.ts";

function newChatKey(token: string): string {
  return `__new__:${token}`;
}

interface ThinkingState {
  isThinking: boolean;
  thinkingText: string;
  thinkingRuns: ThinkingRun[];
}

const IDLE_THINKING: ThinkingState = {
  isThinking: false,
  thinkingText: "",
  thinkingRuns: [],
};

function appendThinkingDelta(
  runs: ThinkingRun[],
  content: string,
  node: string | undefined,
): ThinkingRun[] {
  const last = runs[runs.length - 1];
  if (last && last.node === node) {
    return [...runs.slice(0, -1), { node, text: last.text + content }];
  }
  return [...runs, { node, text: content }];
}

export function Chat() {
  const {
    chats,
    activeChatId,
    newChatToken,
    onChatCreated,
    refreshChats,
    touchChat,
    markChatUnread,
  } = useChats();
  const { hasModel, embeddingModelStatus } = useModels();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const [messagesByChat, setMessagesByChat] = useState<
    Record<string, Message[]>
  >({});
  const [thinkingByChat, setThinkingByChat] = useState<
    Record<string, ThinkingState>
  >({});

  const justCreatedChatIdRef = useRef<string | null>(null);

  const displayKeyRef = useRef<string>(
    activeChatId ?? newChatKey(newChatToken),
  );

  const displayKey = activeChatId ?? newChatKey(newChatToken);
  useEffect(() => {
    displayKeyRef.current = displayKey;
  }, [displayKey]);

  const chatsRef = useRef(chats);
  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);
  const messages = messagesByChat[displayKey] ?? [];
  const { isThinking, thinkingText } =
    thinkingByChat[displayKey] ?? IDLE_THINKING;

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
          thinkingRuns: m.metadata?.thinkingRuns,
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
    if (!hasModel) return;
    if (embeddingModelStatus !== null && !embeddingModelStatus.available)
      return;

    requestNotificationPermission();

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
      [key]: { isThinking: true, thinkingText: "", thinkingRuns: [] },
    }));

    if (activeChatId) {
      touchChat(activeChatId);
    }

    const agentMessageId = crypto.randomUUID();
    let streamStarted = false;
    let capturedThinkingRuns: ThinkingRun[] = [];

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
            return { ...rest, [chatId]: draft ?? IDLE_THINKING };
          });
          key = chatId;
          onChatCreated(chatId);
        },
        onThinking: () => {},
        onThinkingDelta: (delta, node) => {
          setThinkingByChat((prev) => {
            const current = prev[key] ?? IDLE_THINKING;
            const thinkingRuns = appendThinkingDelta(
              current.thinkingRuns,
              delta,
              node,
            );
            capturedThinkingRuns = thinkingRuns;
            return {
              ...prev,
              [key]: {
                isThinking: current.isThinking,
                thinkingText: current.thinkingText + delta,
                thinkingRuns,
              },
            };
          });
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
          updateAgentMessage(key, {
            content: finalContent,
            usedTools,
            steps,
            thinkingRuns: capturedThinkingRuns,
          });
          refreshChats();

          const isBeingViewed =
            displayKeyRef.current === key && isWindowFocused();
          if (!isBeingViewed) {
            markChatUnread(key);
            const chatTitle =
              chatsRef.current.find((c) => c.id === key)?.title || "HiveAI";
            notifyChatResponse(
              chatTitle,
              finalContent.slice(0, 120) || "Nueva respuesta disponible",
            );
          }
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
