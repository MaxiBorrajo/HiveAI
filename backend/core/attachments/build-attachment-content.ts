import { AppError } from "../api/errors.ts";
import type { ModelRef } from "../ai/providers/types.ts";
import {
  isPdfMimeType,
  isTextMimeType,
  isImageMimeType,
  isExcelMimeType,
  MAX_TOTAL_CONTEXT_CHARS,
} from "./attachment-limits.ts";
import {
  readAttachment,
  readAttachmentText,
} from "./attachment-storage.ts";
import { modelSupportsVision } from "./vision-support.ts";
import type { Attachment } from "../../infrastructure/db/repositories/attachment-repository.ts";
import type { AttachmentRepository } from "../../infrastructure/db/repositories/attachment-repository.ts";

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ImageContentPart {
  type: "image";
  mimeType: string;
  data: string;
}

export type AttachmentContentPart = TextContentPart | ImageContentPart;

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Loads every attachment for the given ids and turns them into message
 * content parts the model can use: text/markdown, PDF, and Excel (already
 * extracted) become text blocks labeled with the file name; images become an inline
 * base64 block only if the active model reports vision support, otherwise
 * the attachment is skipped and the caller is told explicitly why — never
 * silently dropped or truncated.
 */
export async function buildAttachmentContent(
  dataDir: string,
  repo: AttachmentRepository,
  attachmentIds: number[],
  modelRef: ModelRef,
): Promise<{ parts: AttachmentContentPart[]; skipped: string[] }> {
  const parts: AttachmentContentPart[] = [];
  const skipped: string[] = [];
  let totalTextChars = 0;
  let visionChecked = false;
  let hasVision = false;

  for (const id of attachmentIds) {
    const row = await repo.findById(id);
    if (!row) throw new AppError(`Attachment ${id} not found.`, 404);

    if (isImageMimeType(row.mimeType)) {
      if (!visionChecked) {
        hasVision = await modelSupportsVision(modelRef);
        visionChecked = true;
      }
      if (!hasVision) {
        skipped.push(
          `'${row.originalName}' was not sent: the active model does not support image input.`,
        );
        continue;
      }
      const bytes = await readAttachment(dataDir, row.storagePath);
      parts.push({ type: "image", mimeType: row.mimeType, data: toBase64(bytes) });
      continue;
    }

    const text = await attachmentText(dataDir, row);
    if (text === undefined) continue;

    if (totalTextChars + text.length > MAX_TOTAL_CONTEXT_CHARS) {
      await repo.updateStatus(id, "context_overflow");
      throw new AppError(
        `'${row.originalName}' does not fit in the model's context (the attached text would exceed ${MAX_TOTAL_CONTEXT_CHARS} characters). Remove an attachment or use a shorter file.`,
        413,
      );
    }
    totalTextChars += text.length;
    parts.push({
      type: "text",
      text: `--- Attached file: ${row.originalName} ---\n${text}`,
    });
  }

  return { parts, skipped };
}

async function attachmentText(
  dataDir: string,
  row: Attachment,
): Promise<string | undefined> {
  if (isTextMimeType(row.mimeType)) {
    return await readAttachmentText(dataDir, row.storagePath);
  }
  if (
    (isPdfMimeType(row.mimeType) || isExcelMimeType(row.mimeType)) &&
    row.extractedTextPath
  ) {
    return await readAttachmentText(dataDir, row.extractedTextPath);
  }
  return undefined;
}
