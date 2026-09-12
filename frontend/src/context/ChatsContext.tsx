import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { listChats as listChatsRequest } from "@/lib/chats/listChats";
import { deleteChat as deleteChatRequest } from "@/lib/chats/deleteChat";
import type { ChatSummary } from "@/types/chat";

interface ChatsContextValue {
  chats: ChatSummary[];
  activeChatId: string | null;
  newChatToken: string;
  isLoadingChats: boolean;
  refreshChats: () => void;
  selectChat: (chatId: string) => void;
  startNewChat: () => void;
  deleteChat: (chatId: string) => Promise<void>;
  onChatCreated: (chatId: string) => void;
  touchChat: (chatId: string) => void;
  unreadChatIds: Set<string>;
  markChatUnread: (chatId: string) => void;
}

const ChatsContext = createContext<ChatsContextValue | null>(null);

export function ChatsProvider({ children }: { children: ReactNode }) {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [newChatToken, setNewChatToken] = useState(() => crypto.randomUUID());
  const [isLoadingChats, setIsLoadingChats] = useState(false);
  const [unreadChatIds, setUnreadChatIds] = useState<Set<string>>(new Set());

  function refreshChats() {
    setIsLoadingChats(true);
    listChatsRequest()
      .then(({ data }) => setChats(data ?? []))
      .finally(() => setIsLoadingChats(false));
  }

  useEffect(refreshChats, []);

  function selectChat(chatId: string) {
    setActiveChatId(chatId);
    markChatRead(chatId);
  }

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

  function startNewChat() {
    setActiveChatId(null);
    setNewChatToken(crypto.randomUUID());
  }

  function onChatCreated(chatId: string) {
    setActiveChatId(chatId);
    refreshChats();
  }

  function touchChat(chatId: string) {
    setChats((prev) => {
      const index = prev.findIndex((chat) => chat.id === chatId);
      if (index === -1) return prev;

      const touched = { ...prev[index], updatedAt: Date.now() };
      const rest = prev.filter((chat) => chat.id !== chatId);
      return [touched, ...rest];
    });
  }

  async function deleteChat(chatId: string) {
    await deleteChatRequest(chatId);
    if (activeChatId === chatId) {
      setActiveChatId(null);
      setNewChatToken(crypto.randomUUID());
    }
    refreshChats();
  }

  const value: ChatsContextValue = {
    chats,
    activeChatId,
    newChatToken,
    isLoadingChats,
    refreshChats,
    selectChat,
    startNewChat,
    deleteChat,
    onChatCreated,
    touchChat,
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
