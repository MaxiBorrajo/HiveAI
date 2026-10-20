import { AppError } from "../../../core/api/errors.ts";
import { readAttachment } from "../../../core/attachments/attachment-storage.ts";
import type { AttachmentDeps } from "../types.ts";

export interface AttachmentDownload {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
}

export async function downloadAttachment(
  deps: AttachmentDeps,
  id: number,
): Promise<AttachmentDownload> {
  const row = await deps.repo.findById(id);
  if (!row) throw new AppError("Attachment not found.", 404);

  const bytes = await readAttachment(deps.dataDir, row.storagePath);
  return { bytes, mimeType: row.mimeType, fileName: row.originalName };
}
