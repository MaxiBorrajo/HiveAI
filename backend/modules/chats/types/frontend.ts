import type { Chat } from "../../../infrastructure/db/schema/chats.ts";
import type { Message } from "../../../infrastructure/db/schema/messages.ts";

export type FrontendChat = Omit<Chat, "id"> & { id: string };
export type FrontendMessage = Omit<Message, "id" | "chatId" | "metadata"> & {
  id: string;
  chatId: string;
  metadata: Record<string, unknown> | null;
};
