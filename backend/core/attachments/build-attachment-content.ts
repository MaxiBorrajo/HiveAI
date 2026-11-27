import { join } from "node:path";
import { AppError } from "../api/errors.ts";
import type { ModelRef } from "../ai/providers/types.ts";
import {
  isTextMimeType,
  isImageMimeType,
  MAX_IMAGE_SIZE_BYTES,
} from "./attachment-limits.ts";
import {
  composeScannedText,
  loadScanImage,
  scanProgress,
} from "./scanned-content.ts";

// Every page is an image the model pays for: the rest goes as OCR text.
const MAX_SCAN_IMAGES_PER_MESSAGE = 10;
const VISION_RENDER_SCALE = 1.5;
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
 * base64 block if the active model reports vision support, otherwise the text
 * OCR read from them, and the call fails with an explicit error when there is
 * none. Text past the context budget is cut:
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
  let scanImagesLeft = MAX_SCAN_IMAGES_PER_MESSAGE;
  let hasVision: boolean | undefined;
  const vision = async () => (hasVision ??= await modelSupportsVision(modelRef));

  for (const id of attachmentIds) {
    const row = await repo.findById(id);
    if (!row) throw new AppError(`Attachment ${id} not found.`, 404);

    const isImage = isImageMimeType(row.mimeType);
    if (isImage && (await vision())) {
      const bytes = await readAttachment(dataDir, row.storagePath);
      parts.push({ type: "image", mimeType: row.mimeType, data: toBase64(bytes) });
      continue;
    }
    if (isImage) {
      // Without vision the model only gets the text OCR found in the image.
      const unseen = `'${row.originalName}' is an image, but the active model (${modelRef.model}) does not support image input`;
      const recognized = row.scan?.texts.image;
      if (row.scan?.status === "pending") {
        throw new AppError(`${unseen}, and the text in it is still being read. Try again in a moment, or switch to a vision model.`, 422);
      }
      if (!recognized) {
        throw new AppError(`${unseen}, and no text could be read from it. Remove it or switch to a vision model.`, 422);
      }
      warnings.push(`${unseen}: it only gets the text read from it.`);
    }

    // Scanned pages and images in documents: the model sees them itself when
    // it can, and reads the OCR text otherwise.
    const imaged = new Set<string>();
    if (row.scan && !isImage) {
      const { scan } = row;
      if (await vision()) {
        for (const source of scan.sources) {
          if (scanImagesLeft === 0) break;
          try {
            const image = await loadScanImage(dataDir, row, source, VISION_RENDER_SCALE);
            if (image.bytes.length > MAX_IMAGE_SIZE_BYTES) continue;
            parts.push(
              { type: "text", text: `[${row.originalName}: ${source.label}]` },
              { type: "image", mimeType: image.mimeType, data: toBase64(image.bytes) },
            );
            imaged.add(source.key);
            scanImagesLeft--;
          } catch (error) {
            console.error(`[Attachments] Could not prepare ${source.label} of '${row.originalName}':`, error);
          }
        }
        if (imaged.size < scan.sources.length) {
          warnings.push(
            `'${row.originalName}': ${imaged.size} of its ${scan.sources.length} scanned pages or images went to the model as images; the rest go as text read by OCR.`,
          );
        }
      } else if (scan.status === "pending") {
        const { done, total } = scanProgress(scan);
        warnings.push(
          `'${row.originalName}': its scanned pages or images are still being read (${done} of ${total}). The model only gets the ones ready so far.`,
        );
      } else if (scan.status === "failed") {
        warnings.push(
          `'${row.originalName}': its scanned pages or images could not be read (${scan.error}). A model with image support can read them.`,
        );
      }
    }

    const text = await attachmentText(dataDir, row, imaged);
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

/** `imaged`: scanned sources sent as images, so their OCR text is left out. */
export async function attachmentText(
  dataDir: string,
  row: Attachment,
  imaged: Set<string> = new Set(),
): Promise<string | undefined> {
  let text: string | undefined;
  if (isTextMimeType(row.mimeType)) {
    text = await readAttachmentText(dataDir, row.storagePath);
  } else if (row.extractedTextPath) {
    text = await readAttachmentText(dataDir, row.extractedTextPath);
  }
  return text !== undefined && row.scan
    ? composeScannedText(text, row.scan, imaged)
    : text;
}
