import { AppError } from "../../../core/api/errors.ts";
import { deleteAttachmentFile } from "../../../core/attachments/attachment-storage.ts";
import type { AttachmentDeps } from "../types.ts";

export async function deleteAttachment(
  deps: AttachmentDeps,
  id: number,
): Promise<void> {
  const row = await deps.repo.findById(id);
  if (!row) throw new AppError("Attachment not found.", 404);

  await deleteAttachmentFile(deps.dataDir, row.storagePath);
  if (row.extractedTextPath) {
    await deleteAttachmentFile(deps.dataDir, row.extractedTextPath);
  }
  await deps.repo.delete(id);
}
