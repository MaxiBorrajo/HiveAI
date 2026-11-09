import { join } from "node:path";
import { AppError } from "../api/errors.ts";
import type { ModelRef } from "../ai/providers/types.ts";
import {
  isTextMimeType,
  isImageMimeType,
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
 * content parts the model can use: text files and documents (already
 * extracted) become text blocks labeled with the file name; images become an inline
 * base64 block only if the active model reports vision support, otherwise
 * the call fails with an explicit error. Text past the context budget is cut:
 * the model reads a marker where it stops and `warnings` tells the user.
 */
export async function buildAttachmentContent(
  dataDir: string,
  repo: AttachmentRepository,
  attachmentIds: number[],
  modelRef: ModelRef,
  maxChars: number,
): Promise<{
  parts: AttachmentContentPart[];
  warnings: string[];
  sentChars: Map<number, number>;
}> {
  const parts: AttachmentContentPart[] = [];
  const warnings: string[] = [];
  const sentChars = new Map<number, number>();
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
        throw new AppError(
          `'${row.originalName}' is an image, but the active model (${modelRef.model}) does not support image input. Remove it or switch to a vision model.`,
          422,
        );
      }
      const bytes = await readAttachment(dataDir, row.storagePath);
      parts.push({ type: "image", mimeType: row.mimeType, data: toBase64(bytes) });
      continue;
    }

    const text = await attachmentText(dataDir, row);
    if (text === undefined) continue;
    const filePath = join(dataDir, row.storagePath);

    const available = maxChars - totalTextChars;
    if (available <= 0) {
      sentChars.set(id, 0);
      warnings.push(
        `'${row.originalName}' was left out: the attachments already reach the limit of ${maxChars} characters for this model.`,
      );
      continue;
    }
    const included = text.slice(0, available);
    const truncated = included.length < text.length;
    if (truncated) {
      warnings.push(
        `'${row.originalName}' was cut: the model only reads its first ${included.length} of ${text.length} characters.`,
      );
    }
    totalTextChars += included.length;
    sentChars.set(id, truncated ? included.length : Infinity);
    const marker = truncated
      ? `\n[… file truncated: only the first ${included.length} of ${text.length} characters are shown …]`
      : "";
    parts.push({
      type: "text",
      text: `--- Attached file: ${row.originalName} (saved at: ${filePath}, read-only: never modify or write next to it) ---\n${included}${marker}`,
    });
  }

  return { parts, warnings, sentChars };
}

export async function attachmentText(
  dataDir: string,
  row: Attachment,
): Promise<string | undefined> {
  if (isTextMimeType(row.mimeType)) {
    return await readAttachmentText(dataDir, row.storagePath);
  }
  if (row.extractedTextPath) {
    return await readAttachmentText(dataDir, row.extractedTextPath);
  }
  return undefined;
}
