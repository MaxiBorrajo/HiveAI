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
  thinkingRuns: ThinkingRun[];
}

const IDLE_THINKING: ThinkingState = {
  isThinking: false,
  thinkingText: "",
  thinkingRuns: [],
};

// Appends a delta to the run list, opening a new run whenever the
// producing node changes (or on the very first delta) so a node that
// executes more than once in a turn ends up as separate runs instead of
// one merged blob — mirrors how the backend's `steps` array accumulates
// one entry per node execution rather than collapsing repeats.
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

  // Tracks the currently-viewed chat/draft key live, so a response that
  // finishes after the user has switched chats can tell it's no longer
  // being watched — reading activeChatId/newChatToken directly here would
  // only ever see the value captured when handleSend started.
  const displayKeyRef = useRef<string>(activeChatId ?? newChatKey(newChatToken));

  const displayKey = activeChatId ?? newChatKey(newChatToken);
  useEffect(() => {
    displayKeyRef.current = displayKey;
  }, [displayKey]);

  const chatsRef = useRef(chats);
  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);
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
    if (!hasModel) return;
    if (embeddingModelStatus !== null && !embeddingModelStatus.available) return;

    // Fired from this click/submit gesture so the browser/webview is willing
    // to show the OS permission prompt — requesting it later from onDone
    // (an async stream callback, not a user gesture) gets silently ignored.
    requestNotificationPermission();

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
