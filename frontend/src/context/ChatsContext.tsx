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
  isLoadingChats: boolean;
  refreshChats: () => void;
  selectChat: (chatId: string) => void;
  startNewChat: () => void;
  deleteChat: (chatId: string) => Promise<void>;
  onChatCreated: (chatId: string) => void;
}

const ChatsContext = createContext<ChatsContextValue | null>(null);

export function ChatsProvider({ children }: { children: ReactNode }) {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [isLoadingChats, setIsLoadingChats] = useState(false);

  function refreshChats() {
    setIsLoadingChats(true);
    listChatsRequest()
      .then(({ data }) => setChats(data ?? []))
      .finally(() => setIsLoadingChats(false));
  }

  useEffect(refreshChats, []);

  function selectChat(chatId: string) {
    setActiveChatId(chatId);
  }

  function startNewChat() {
    setActiveChatId(null);
  }

  function onChatCreated(chatId: string) {
    setActiveChatId(chatId);
    refreshChats();
  }

  async function deleteChat(chatId: string) {
    await deleteChatRequest(chatId);
    if (activeChatId === chatId) {
      setActiveChatId(null);
    }
    refreshChats();
  }

  const value: ChatsContextValue = {
    chats,
    activeChatId,
    isLoadingChats,
    refreshChats,
    selectChat,
    startNewChat,
    deleteChat,
    onChatCreated,
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
