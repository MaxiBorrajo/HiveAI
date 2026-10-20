import type { AttachmentDeps, AttachmentDto } from "../types.ts";
import { toAttachmentDto } from "../types.ts";

export async function getChatAttachments(
  deps: AttachmentDeps,
  chatId: number,
): Promise<AttachmentDto[]> {
  const rows = await deps.repo.findByChatId(chatId);
  return rows.map(toAttachmentDto);
}
