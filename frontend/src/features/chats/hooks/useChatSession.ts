import { useEffect, useRef } from "react";
import { sendMessage, type LiveToolCall } from "../api/sendMessage.ts";
import type { AttachmentDto } from "../api/attachments.ts";
import { getChatMessages } from "../api/getChatMessages.ts";
import { reportError } from "../../../lib/toastManager.ts";
import { getErrorMessage } from "../../../lib/errors.ts";
import { useKeyedState } from "../../../hooks/useKeyedState.ts";
import type {
  ChatStep,
  ConversationUsage,
  Message,
  StoredMessage,
  ThinkingRun,
} from "../types.ts";
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
  phase: "processing" | "loading_model";
  liveSteps: ChatStep[];
  liveTools: LiveToolCall[];
  isBusy: boolean;
}

const NO_MESSAGES: Message[] = [];
const IDLE_THINKING: ThinkingState = {
  isThinking: false,
  thinkingText: "",
  phase: "processing",
  liveSteps: [],
  liveTools: [],
  isBusy: false,
};

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
    wasStopped: stored.metadata?.wasStopped,
    usage: stored.usage ?? null,
    attachments: stored.attachments,
  };
}

class RejectedSendError extends Error {}

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
  const usageState = useKeyedState<ConversationUsage | null>(displayKey, null);

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
      usageState.set(data.usage ?? null, activeChatId);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId]);

  async function send(
    content: string,
    onAccepted?: () => void,
    attachments?: AttachmentDto[],
    onRejected?: () => void,
  ): Promise<boolean> {
    if (!content || thinkingState.value.isBusy) return false;
    if (!hasModel) return false;
    if (embeddingModelStatus !== null && !embeddingModelStatus.available) {
      return false;
    }

    onAccepted?.();
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

    const userMessageId = crypto.randomUUID();
    appendMessage({
      id: userMessageId,
      role: "user",
      content,
      timestamp: Date.now(),
      attachments,
    });
    thinkingState.set(
      {
        isThinking: true,
        thinkingText: "",
        phase: "processing",
        liveSteps: [],
        liveTools: [],
        isBusy: true,
      },
      key,
    );
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
            usageState.moveKey(startKey, chatId);
            key = chatId;
            onChatCreated(chatId);
          },
          onThinking: () => {},
          onStep: (step) => {
            thinkingState.set(
              (prev) => ({
                ...prev,
                thinkingText: "",
                liveSteps: [...prev.liveSteps, step],
                liveTools: [],
              }),
              key,
            );
          },
          onToolCalls: (calls) => {
            thinkingState.set((prev) => ({ ...prev, liveTools: calls }), key);
          },
          onStatus: (phase) => {
            thinkingState.set((prev) => ({ ...prev, phase }), key);
          },
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
              thinkingState.set({ ...IDLE_THINKING, isBusy: true }, key);
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
          onDone: (finalContent, usedTools, steps, usage, conversationUsage) => {
            patchAgentMessage((m) => ({
              ...m,
              content: finalContent,
              usedTools,
              steps,
              thinkingRuns,
              usage,
            }));
            if (conversationUsage) usageState.set(conversationUsage, key);
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
          onError: (errorMessage, rejected) => {
            reportError([errorMessage]);
            if (rejected) throw new RejectedSendError(errorMessage);
            throw new Error(errorMessage);
          },
        },
        abortController.signal,
        attachments?.map((a) => a.id),
      );
    } catch (error) {
      if (error instanceof RejectedSendError) {
        // Nothing was persisted: drop the optimistic message and give the
        // draft back so the user can fix it.
        messagesState.set(
          (prev) => prev.filter((m) => m.id !== userMessageId),
          key,
        );
        onRejected?.();
      } else if (abortController.signal.aborted) {
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
    isBusy: thinkingState.value.isBusy,
    thinkingText: thinkingState.value.thinkingText,
    phase: thinkingState.value.phase,
    liveSteps: thinkingState.value.liveSteps,
    liveTools: thinkingState.value.liveTools,
    conversationUsage: usageState.value,
    send,
    stop: () => abortControllerRef.current?.abort(),
  };
}
