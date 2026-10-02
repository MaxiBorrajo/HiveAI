import { useEffect, useRef } from "react";
import { sendMessage } from "../api/sendMessage.ts";
import { getChatMessages } from "../api/getChatMessages.ts";
import { reportError } from "../../../lib/toastManager.ts";
import { getErrorMessage } from "../../../lib/errors.ts";
import { useKeyedState } from "../../../hooks/useKeyedState.ts";
import type { Message, StoredMessage, ThinkingRun } from "../types.ts";
import { useChats } from "../ChatsContext.tsx";
import { useModels } from "../../models/ModelsContext.tsx";
import {
  isWindowFocused,
  notifyChatResponse,
  requestNotificationPermission,
} from "../../../lib/notify.ts";

interface ThinkingState {
  isThinking: boolean;
  thinkingText: string;
}

const NO_MESSAGES: Message[] = [];
const IDLE_THINKING: ThinkingState = { isThinking: false, thinkingText: "" };

function newChatKey(token: string): string {
  return `__new__:${token}`;
}

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

function toMessage(stored: StoredMessage): Message {
  return {
    id: stored.id,
    role: stored.role,
    content: stored.content,
    timestamp: stored.timestamp,
    usedTools: stored.metadata?.usedTools,
    steps: stored.metadata?.steps,
    thinkingRuns: stored.metadata?.thinkingRuns,
  };
}

export function useChatSession() {
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

  const displayKey = activeChatId ?? newChatKey(newChatToken);
  const messagesState = useKeyedState<Message[]>(displayKey, NO_MESSAGES);
  const thinkingState = useKeyedState<ThinkingState>(displayKey, IDLE_THINKING);

  const justCreatedChatIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const displayKeyRef = useRef(displayKey);
  const chatsRef = useRef(chats);
  useEffect(() => {
    displayKeyRef.current = displayKey;
    chatsRef.current = chats;
  }, [displayKey, chats]);

  const { set: setMessages } = messagesState;
  useEffect(() => {
    if (!activeChatId) return;

    if (justCreatedChatIdRef.current === activeChatId) {
      justCreatedChatIdRef.current = null;
      return;
    }

    let cancelled = false;
    getChatMessages(activeChatId).then(({ data }) => {
      if (cancelled || !data) return;
      setMessages(data.messages.map(toMessage), activeChatId);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId]);

  async function send(content: string): Promise<boolean> {
    if (!content || thinkingState.value.isThinking) return false;
    if (!hasModel) return false;
    if (embeddingModelStatus !== null && !embeddingModelStatus.available) {
      return false;
    }

    requestNotificationPermission();

    const startKey = displayKey;
    let key = startKey;
    const agentMessageId = crypto.randomUUID();
    let streamStarted = false;
    let thinkingRuns: ThinkingRun[] = [];

    const appendMessage = (message: Message) =>
      messagesState.set((prev) => [...prev, message], key);
    const patchAgentMessage = (patch: (m: Message) => Message) =>
      messagesState.set(
        (prev) => prev.map((m) => (m.id === agentMessageId ? patch(m) : m)),
        key,
      );

    appendMessage({
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: Date.now(),
    });
    thinkingState.set({ isThinking: true, thinkingText: "" }, key);
    if (activeChatId) touchChat(activeChatId);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      await sendMessage(
        activeChatId,
        content,
        {
          onChatCreated: (chatId) => {
            justCreatedChatIdRef.current = chatId;
            messagesState.moveKey(startKey, chatId);
            thinkingState.moveKey(startKey, chatId);
            key = chatId;
            onChatCreated(chatId);
          },
          onThinking: () => {},
          onThinkingDelta: (delta, node) => {
            thinkingRuns = appendThinkingDelta(thinkingRuns, delta, node);
            thinkingState.set(
              (prev) => ({ ...prev, thinkingText: prev.thinkingText + delta }),
              key,
            );
          },
          onToken: (token) => {
            if (!streamStarted) {
              streamStarted = true;
              thinkingState.set(IDLE_THINKING, key);
              appendMessage({
                id: agentMessageId,
                role: "agent",
                content: token,
                timestamp: Date.now(),
              });
              return;
            }
            patchAgentMessage((m) => ({ ...m, content: m.content + token }));
          },
          onDone: (finalContent, usedTools, steps) => {
            patchAgentMessage((m) => ({
              ...m,
              content: finalContent,
              usedTools,
              steps,
              thinkingRuns,
            }));
            refreshChats();

            const isBeingViewed =
              displayKeyRef.current === key && isWindowFocused();
            if (!isBeingViewed) {
              markChatUnread(key);
              const chatTitle =
                chatsRef.current.find((c) => c.id === key)?.title || "HiveAI";
              notifyChatResponse(
                chatTitle,
                finalContent.slice(0, 120) || "New response available",
              );
            }
          },
          onError: (errorMessage) => {
            reportError([errorMessage]);
            throw new Error(errorMessage);
          },
        },
        abortController.signal,
      );
    } catch (error) {
      if (abortController.signal.aborted) {
        messagesState.set((prev) => {
          const hasPartial = prev.some((m) => m.id === agentMessageId);
          return hasPartial
            ? prev.map((m) =>
                m.id === agentMessageId ? { ...m, wasStopped: true } : m,
              )
            : [
                ...prev,
                {
                  id: agentMessageId,
                  role: "agent",
                  content: "",
                  wasStopped: true,
                  timestamp: Date.now(),
                },
              ];
        }, key);
      } else {
        messagesState.set(
          (prev) => [
            ...prev.filter((m) => m.id !== agentMessageId),
            {
              id: crypto.randomUUID(),
              role: "agent",
              content: `Could not get a response: ${getErrorMessage(error, "no detail available")}`,
              isError: true,
              timestamp: Date.now(),
            },
          ],
          key,
        );
      }
    } finally {
      abortControllerRef.current = null;
      thinkingState.set(IDLE_THINKING, key);
    }
    return true;
  }

  return {
    messages: messagesState.value,
    isThinking: thinkingState.value.isThinking,
    thinkingText: thinkingState.value.thinkingText,
    send,
    stop: () => abortControllerRef.current?.abort(),
  };
}
