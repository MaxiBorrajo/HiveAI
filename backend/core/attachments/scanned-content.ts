import { renderPageAsImage } from "unpdf";
import { readAttachment } from "./attachment-storage.ts";
import { readZipEntry } from "./office-text-extractor.ts";
import type { Attachment } from "../../infrastructure/db/repositories/attachment-repository.ts";

/** A scanned PDF page or an image inside a document, read by OCR. */
export interface ScanSource {
  key: string;
  label: string;
  page?: number;
  mediaPath?: string;
  mimeType?: string;
}

export interface ScanState {
  sources: ScanSource[];
  /** Recognized text by source key; a missing key is not read yet. */
  texts: Record<string, string>;
  status: "pending" | "done" | "failed";
  error?: string;
}

/** Text extracted on upload, with a marker where each source's text goes. */
export interface ExtractedDocument {
  text: string;
  sources: ScanSource[];
}

const MARKER = /⟦scan:([^⟧]+)⟧/g;

export function scanMarker(key: string): string {
  return `⟦scan:${key}⟧`;
}

/**
 * Puts the recognized text where each source was. Sources in `imaged` are
 * sent to the model as images, so only a reference to them is left.
 */
export function composeScannedText(
  text: string,
  scan: ScanState,
  imaged: Set<string> = new Set(),
): string {
  const byKey = new Map(scan.sources.map((source) => [source.key, source]));
  return text.replace(MARKER, (_, key: string) => {
    const source = byKey.get(key);
    if (!source) return "";
    if (imaged.has(key)) return `[${source.label}: its image is attached]`;
    const recognized = scan.texts[key];
    if (recognized === undefined) {
      return scan.status === "failed"
        ? `[${source.label}: an image whose text could not be read]`
        : `[${source.label}: an image whose text is still being read]`;
    }
    return recognized ? `[${source.label}, text read from the image]\n${recognized}` : "";
  });
}

export function scanProgress(scan: ScanState): { done: number; total: number } {
  return { done: Object.keys(scan.texts).length, total: scan.sources.length };
}

export async function renderPdfPage(
  bytes: Uint8Array,
  page: number,
  scale: number,
): Promise<Uint8Array> {
  // pdf.js takes ownership of the buffer it is given.
  const png = await renderPageAsImage(bytes.slice(), page, {
    canvasImport: () => import("@napi-rs/canvas"),
    scale,
  });
  return new Uint8Array(png);
}

export async function loadScanImage(
  dataDir: string,
  row: Attachment,
  source: ScanSource,
  scale: number,
): Promise<{ mimeType: string; bytes: Uint8Array }> {
  const file = await readAttachment(dataDir, row.storagePath);
  if (source.page !== undefined) {
    return {
      mimeType: "image/png",
      bytes: await renderPdfPage(file, source.page, scale),
    };
  }
  return {
    mimeType: source.mimeType ?? "image/png",
    bytes: await readZipEntry(file, source.mediaPath!),
  };
}
