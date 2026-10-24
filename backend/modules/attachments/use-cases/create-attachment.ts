import { AppError } from "../../../core/api/errors.ts";
import {
  MAX_FILE_SIZE_BYTES,
  isSupportedMimeType,
  isPdfMimeType,
  isExcelMimeType,
} from "../../../core/attachments/attachment-limits.ts";
import {
  saveAttachment,
  saveExtractedText,
} from "../../../core/attachments/attachment-storage.ts";
import { extractTextFromPdf } from "../../../core/attachments/pdf-text-extractor.ts";
import { extractTextFromExcel } from "../../../core/attachments/excel-text-extractor.ts";
import type { AttachmentDeps, AttachmentDto } from "../types.ts";
import { toAttachmentDto } from "../types.ts";

export interface AttachmentOwner {
  chatId?: number;
  executionId?: number;
}

export async function createAttachment(
  deps: AttachmentDeps,
  file: File,
  direction: "input" | "output",
  owner: AttachmentOwner,
): Promise<AttachmentDto> {
  const mimeType = file.type || "application/octet-stream";

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new AppError(
      `'${file.name}' is ${(file.size / 1024 / 1024).toFixed(1)}MB, which exceeds the ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB limit.`,
      413,
    );
  }

  if (!isSupportedMimeType(mimeType)) {
    throw new AppError(
      `'${file.name}' has an unsupported type (${mimeType}). Supported: plain text, Markdown, CSV, PDF, Excel, and PNG/JPEG/GIF/WebP images.`,
      415,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const storagePath = await saveAttachment(deps.dataDir, bytes, file.name);

  let extractedTextPath: string | undefined;
  if (isPdfMimeType(mimeType)) {
    try {
      const text = await extractTextFromPdf(bytes);
      extractedTextPath = await saveExtractedText(deps.dataDir, text);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new AppError(
        `Could not extract text from '${file.name}': ${detail}`,
        422,
      );
    }
  } else if (isExcelMimeType(mimeType)) {
    try {
      const text = extractTextFromExcel(bytes);
      extractedTextPath = await saveExtractedText(deps.dataDir, text);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new AppError(
        `Could not read '${file.name}': ${detail}`,
        422,
      );
    }
  }

  const row = await deps.repo.create({
    chatId: owner.chatId ?? null,
    executionId: owner.executionId ?? null,
    messageId: null,
    executionHistoryId: null,
    direction,
    originalName: file.name,
    mimeType,
    sizeBytes: file.size,
    storagePath,
    extractedTextPath: extractedTextPath ?? null,
    status: "ready",
    createdAt: Date.now(),
  });

  return toAttachmentDto(row);
}
