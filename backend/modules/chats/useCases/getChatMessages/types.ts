import type { ChatStepMetadata } from "../../types/memory.ts";
import type { ChatRecord } from "../../../../infrastructure/db/repositories/ChatRepository.ts";

export interface ChatMessageResponse {
  id: number;
  chatId: number;
  role: "user" | "agent";
  content: string;
  timestamp: number;
  metadata: ChatStepMetadata | null;
}

export interface GetChatMessagesResponse {
  chat: ChatRecord;
  messages: MessageRecord[];
}
