export interface SendMessageRequest {
  message: string;
}

export interface SendMessageResponse {
  content: unknown;
  usedTools: string[];
}

