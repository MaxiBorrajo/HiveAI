export interface SendMessageRequest {
  chatId?: string;
  message: string;
}

export interface SendMessageResponse {
  content: unknown;
  usedTools: string[];
}
