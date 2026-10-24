export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_TOTAL_CONTEXT_CHARS = 100_000;

export const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "text/csv",
]);

export const PDF_MIME_TYPE = "application/pdf";

export const EXCEL_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
]);

export function isTextMimeType(mimeType: string): boolean {
  return TEXT_MIME_TYPES.has(mimeType);
}

export function isPdfMimeType(mimeType: string): boolean {
  return mimeType === PDF_MIME_TYPE;
}

export function isExcelMimeType(mimeType: string): boolean {
  return EXCEL_MIME_TYPES.has(mimeType);
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
    isImageMimeType(mimeType)
  );
}
