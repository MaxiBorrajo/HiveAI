import type { ChatRecord, MessageRecord } from "../../../../core/memory/types.ts";

export interface GetChatMessagesResponse {
  chat: ChatRecord;
  messages: MessageRecord[];
}
