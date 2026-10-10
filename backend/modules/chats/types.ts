import type { Chat } from "../../infrastructure/db/schema/chats.ts";
import type { MessageUsage } from "../usage/types.ts";
import type { Message } from "../../infrastructure/db/schema/messages.ts";

export type FrontendChat = Omit<Chat, "id"> & { id: string };
export type FrontendMessage = Omit<Message, "id" | "chatId" | "metadata"> & {
  id: string;
  chatId: string;
  metadata: Record<string, unknown> | null;
  // null: nothing was recorded for this message (it predates usage tracking,
  // or it is a user message).
  usage: MessageUsage | null;
};
