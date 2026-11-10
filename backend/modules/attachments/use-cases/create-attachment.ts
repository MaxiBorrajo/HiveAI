import { AppError } from "../../../core/api/errors.ts";
import {
  MAX_FILE_SIZE_BYTES,
  MAX_IMAGE_SIZE_BYTES,
  SUPPORTED_FORMATS_LABEL,
  isDocxMimeType,
  isExcelMimeType,
  isImageMimeType,
  isPdfMimeType,
  isPptxMimeType,
  isSupportedMimeType,
  resolveMimeType,
} from "../../../core/attachments/attachment-limits.ts";
import {
  deleteAttachmentFile,
  saveAttachment,
  saveExtractedText,
} from "../../../core/attachments/attachment-storage.ts";
import { extractTextFromPdf } from "../../../core/attachments/pdf-text-extractor.ts";
import { extractTextFromExcel } from "../../../core/attachments/excel-text-extractor.ts";
import {
  extractTextFromDocx,
  extractTextFromPptx,
} from "../../../core/attachments/office-text-extractor.ts";
import type { AttachmentDeps, AttachmentDto } from "../types.ts";
import { toAttachmentDto } from "../types.ts";

export interface AttachmentOwner {
  chatId?: number;
  executionId?: number;
}

type TextExtractor = (bytes: Uint8Array) => string | Promise<string>;

function textExtractorFor(mimeType: string): TextExtractor | undefined {
  if (isPdfMimeType(mimeType)) return extractTextFromPdf;
  if (isExcelMimeType(mimeType)) return extractTextFromExcel;
  if (isDocxMimeType(mimeType)) return extractTextFromDocx;
  if (isPptxMimeType(mimeType)) return extractTextFromPptx;
  return undefined;
}

export async function createAttachment(
  deps: AttachmentDeps,
  file: File,
  direction: "input" | "output",
  owner: AttachmentOwner,
): Promise<AttachmentDto> {
  const mimeType = resolveMimeType(
    file.name,
    file.type || "application/octet-stream",
  );

  const isImage = isImageMimeType(mimeType);
  const maxBytes = isImage ? MAX_IMAGE_SIZE_BYTES : MAX_FILE_SIZE_BYTES;
  if (file.size > maxBytes) {
    throw new AppError(
      `'${file.name}' is ${(file.size / 1024 / 1024).toFixed(1)}MB, which exceeds the ${maxBytes / 1024 / 1024}MB limit for ${isImage ? "images" : "files"}.`,
      413,
    );
  }

  if (!isSupportedMimeType(mimeType)) {
    throw new AppError(
      `'${file.name}' has an unsupported type (${mimeType}). Supported: ${SUPPORTED_FORMATS_LABEL}.`,
      415,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const storagePath = await saveAttachment(deps.dataDir, bytes, file.name);

  let extractedTextPath: string | undefined;
  const extractor = textExtractorFor(mimeType);
  if (extractor) {
    try {
      extractedTextPath = await saveExtractedText(
        deps.dataDir,
        await extractor(bytes),
      );
    } catch (error) {
      await deleteAttachmentFile(deps.dataDir, storagePath);
      const detail = error instanceof Error ? error.message : String(error);
      throw new AppError(`Could not read '${file.name}': ${detail}`, 422);
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

  // Runs read their files whole: only chats search them.
  if (owner.executionId === undefined && !isImageMimeType(mimeType)) {
    deps.scheduleIndexing?.(row.id);
  }

  return toAttachmentDto(row);
}
