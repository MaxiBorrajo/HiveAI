import { postSse } from "@/lib/sse";

export interface ChatEditDraftHandlers {
  onThinking?: (message: string) => void;
  onWriting?: (sourceCode: string, summary?: string) => void;
  onValidating?: () => void;
  onValidationError?: (data: { attempt: number; issues: string[] }) => void;
  onDone?: (data: { sourceCode: string; summary?: string }) => void;
  onError?: (message: string) => void;
}

export async function chatEditDraftStream(
  draftName: string,
  content: string,
  handlers: ChatEditDraftHandlers,
  signal?: AbortSignal,
): Promise<void> {
  await postSse(
    `/api/drafts/${encodeURIComponent(draftName)}/chat`,
    { content },
    (eventName, data) => {
      switch (eventName) {
        case "thinking":
          handlers.onThinking?.(data.message);
          break;
        case "writing":
          handlers.onWriting?.(data.sourceCode, data.summary);
          break;
        case "validating":
          handlers.onValidating?.();
          break;
        case "validation_error":
          handlers.onValidationError?.(data);
          break;
        case "done":
          handlers.onDone?.(data);
          break;
        case "error":
          handlers.onError?.(data.message);
          break;
      }
    },
    signal,
  );
}
