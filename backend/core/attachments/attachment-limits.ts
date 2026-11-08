import { extname } from "node:path";

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_TOTAL_CONTEXT_CHARS = 100_000;

export const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "text/csv",
  "application/json",
]);

export const PDF_MIME_TYPE = "application/pdf";

export const XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const XLS_MIME_TYPE = "application/vnd.ms-excel";
export const EXCEL_MIME_TYPES = new Set([XLSX_MIME_TYPE, XLS_MIME_TYPE]);

export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PPTX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export const SUPPORTED_FORMATS_LABEL =
  "plain text, Markdown, CSV, JSON, PDF, Word (.docx), Excel (.xlsx, .xls), PowerPoint (.pptx), and PNG/JPEG/GIF/WebP images";

// The extension wins over the browser's type, which depends on the OS: Windows
// can report nothing for .md and an Excel type for .csv.
const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".pdf": PDF_MIME_TYPE,
  ".xlsx": XLSX_MIME_TYPE,
  ".xls": XLS_MIME_TYPE,
  ".docx": DOCX_MIME_TYPE,
  ".pptx": PPTX_MIME_TYPE,
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export function resolveMimeType(
  fileName: string,
  browserMimeType: string,
): string {
  return MIME_TYPE_BY_EXTENSION[extname(fileName).toLowerCase()] ??
    browserMimeType;
}

export function isTextMimeType(mimeType: string): boolean {
  return TEXT_MIME_TYPES.has(mimeType);
}

export function isPdfMimeType(mimeType: string): boolean {
  return mimeType === PDF_MIME_TYPE;
}

export function isExcelMimeType(mimeType: string): boolean {
  return EXCEL_MIME_TYPES.has(mimeType);
}

export function isDocxMimeType(mimeType: string): boolean {
  return mimeType === DOCX_MIME_TYPE;
}

export function isPptxMimeType(mimeType: string): boolean {
  return mimeType === PPTX_MIME_TYPE;
}

// Formats accepted by Anthropic, Gemini and Ollama vision models alike.
export const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export function isImageMimeType(mimeType: string): boolean {
  return IMAGE_MIME_TYPES.has(mimeType);
}

/**
 * Whether the backend knows how to turn this mime type into something a
 * model can use at all (text extraction, or an image block when the model
 * supports vision). Image support is checked separately per-model at the
 * point of use, since it depends on which model is active.
 */
export function isSupportedMimeType(mimeType: string): boolean {
  return (
    isTextMimeType(mimeType) ||
    isPdfMimeType(mimeType) ||
    isExcelMimeType(mimeType) ||
    isDocxMimeType(mimeType) ||
    isPptxMimeType(mimeType) ||
    isImageMimeType(mimeType)
  );
}
