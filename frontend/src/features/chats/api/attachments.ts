import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";

const quiet = { silenceErrorToast: true };

export const ACCEPTED_ATTACHMENT_TYPES =
  ".txt,.md,.pdf,.xlsx,.xls,image/*";

export type AttachmentDirection = "input" | "output";
export type AttachmentStatus =
  | "ready"
  | "rejected_size"
  | "rejected_type"
  | "context_overflow";

export interface AttachmentDto {
  id: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  direction: AttachmentDirection;
  status: AttachmentStatus;
  createdAt: number;
}

async function upload(
  path: string,
  file: File,
  direction: AttachmentDirection,
): Promise<ResponseEntity<AttachmentDto>> {
  const form = new FormData();
  form.append("file", file);
  form.append("direction", direction);
  return (await apiClient.post(path, form, quiet)).data;
}

export async function uploadChatAttachment(
  chatId: string | null,
  file: File,
): Promise<ResponseEntity<AttachmentDto>> {
  return upload(
    chatId
      ? `/api/chats/${encodeURIComponent(chatId)}/attachments`
      : "/api/attachments",
    file,
    "input",
  );
}

export async function getChatAttachments(
  chatId: string,
): Promise<ResponseEntity<AttachmentDto[]>> {
  return (
    await apiClient.get(
      `/api/chats/${encodeURIComponent(chatId)}/attachments`,
      quiet,
    )
  ).data;
}

export async function uploadExecutionAttachment(
  executionId: number,
  file: File,
): Promise<ResponseEntity<AttachmentDto>> {
  return upload(`/api/executions/${executionId}/attachments`, file, "input");
}

export async function getExecutionAttachments(
  executionId: number,
): Promise<ResponseEntity<AttachmentDto[]>> {
  return (
    await apiClient.get(`/api/executions/${executionId}/attachments`, quiet)
  ).data;
}

export async function getExecutionHistoryAttachments(
  historyId: number,
): Promise<ResponseEntity<AttachmentDto[]>> {
  return (
    await apiClient.get(
      `/api/execution-history/${historyId}/attachments`,
      quiet,
    )
  ).data;
}

export function attachmentDownloadUrl(id: number): string {
  return `${apiClient.defaults.baseURL ?? ""}/api/attachments/${id}/download`;
}

export async function deleteAttachment(
  id: number,
): Promise<ResponseEntity<undefined>> {
  return (await apiClient.delete(`/api/attachments/${id}`, quiet)).data;
}
