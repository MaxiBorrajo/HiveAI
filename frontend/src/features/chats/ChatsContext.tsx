import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { listChats } from "@/features/chats/api/listChats";
import { deleteChat } from "@/features/chats/api/deleteChat";
import { updateChat as updateChatRequest, type UpdateChatDto } from "@/features/chats/api/updateChat";
import { useEntityListState } from "@/hooks/useEntityListState";
import type { ChatSummary } from "@/features/chats/types";

interface ChatsContextValue {
  chats: ChatSummary[];
  activeChatId: string | null;
  newChatToken: string;
  isLoadingChats: boolean;
  refreshChats: () => void;
  selectChat: (chatId: string) => void;
  startNewChat: () => void;
  deleteChat: (chatId: string) => Promise<void>;
  updateChat: (
    chatId: string,
    titleOrDto: string | { title: string },
  ) => Promise<void>;
  renameChat: (chatId: string, title: string) => Promise<void>;
  onChatCreated: (chatId: string) => void;
  touchChat: (chatId: string) => void;
  unreadChatIds: Set<string>;
  markChatUnread: (chatId: string) => void;
}

const ChatsContext = createContext<ChatsContextValue | null>(null);

export function ChatsProvider({ children }: { children: ReactNode }) {
  const [unreadChatIds, setUnreadChatIds] = useState<Set<string>>(new Set());

  const state = useEntityListState<ChatSummary, UpdateChatDto>(
    { list: listChats, remove: deleteChat, update: updateChatRequest },
    (chat, dto, serverChat) => ({
      ...chat,
      title: serverChat?.title ?? dto.title,
      updatedAt: serverChat?.updatedAt ?? Date.now(),
    }),
  );

  function markChatRead(chatId: string) {
    setUnreadChatIds((prev) => {
      if (!prev.has(chatId)) return prev;
      const next = new Set(prev);
      next.delete(chatId);
      return next;
    });
  }

  function markChatUnread(chatId: string) {
    setUnreadChatIds((prev) => {
      if (prev.has(chatId)) return prev;
      const next = new Set(prev);
      next.add(chatId);
      return next;
    });
  }

  function selectChat(chatId: string) {
    state.select(chatId);
    markChatRead(chatId);
  }

  async function updateChat(
    chatId: string,
    titleOrDto: string | { title: string },
  ) {
    const title =
      typeof titleOrDto === "string" ? titleOrDto : titleOrDto.title;
    await state.update(chatId, { title });
  }

  const value: ChatsContextValue = {
    chats: state.items,
    activeChatId: state.activeId,
    newChatToken: state.newItemToken,
    isLoadingChats: state.isLoading,
    refreshChats: state.refresh,
    selectChat,
    startNewChat: state.startNew,
    deleteChat: state.remove,
    updateChat,
    renameChat: (chatId: string, title: string) => updateChat(chatId, title),
    onChatCreated: state.onCreated,
    touchChat: state.touch,
    unreadChatIds,
    markChatUnread,
  };

  return (
    <ChatsContext.Provider value={value}>{children}</ChatsContext.Provider>
  );
}

export function useChats(): ChatsContextValue {
  const context = useContext(ChatsContext);
  if (!context) {
    throw new Error("useChats must be used within a ChatsProvider");
  }
  return context;
}
