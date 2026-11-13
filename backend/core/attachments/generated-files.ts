import { AsyncLocalStorage } from "node:async_hooks";
import { extname } from "node:path";
import { DOCX_MIME_TYPE, MAX_FILE_SIZE_BYTES } from "./attachment-limits.ts";
import { saveAttachment, saveExtractedText } from "./attachment-storage.ts";
import { markdownToDocx } from "./markdown-docx.ts";
import { sanitizeFilename } from "../files/save-to-downloads.ts";
import type {
  Attachment,
  AttachmentRepository,
} from "../../infrastructure/db/repositories/attachment-repository.ts";

/** Where created files go (a chat or a run), and who hears about failures. */
export interface GeneratedFilesContext {
  dataDir: string;
  repo: AttachmentRepository;
  chatId?: number;
  executionId?: number;
  executionHistoryId?: number;
  files: Attachment[];
  onFailure: (message: string) => void;
}

/** Set only around a chat turn: outside one, models cannot create files. */
export const generatedFilesStorage = new AsyncLocalStorage<GeneratedFilesContext>();

const TEXT_FORMATS: Record<string, string> = {
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
};

// Stored as plain text, so they get a preview and are searchable.
const CODE_EXTENSIONS = new Set([
  ".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".sql", ".sh", ".ps1",
  ".bat", ".xml", ".yaml", ".yml", ".toml", ".ini", ".java", ".kt", ".c", ".h",
  ".cpp", ".cs", ".go", ".rs", ".rb", ".php", ".swift",
]);

export const GENERATED_FORMATS_LABEL =
  ".md, .txt, .csv, .json, .docx, or a code file extension such as .py, .js or .html";

/** The message reaches the model so it can fix the call. */
export class GeneratedFileError extends Error {}

function mimeTypeFor(extension: string): string | undefined {
  if (extension === ".docx") return DOCX_MIME_TYPE;
  return TEXT_FORMATS[extension] ??
    (CODE_EXTENSIONS.has(extension) ? "text/plain" : undefined);
}

export async function createGeneratedFile(
  context: GeneratedFilesContext,
  fileName: string,
  content: string,
): Promise<Attachment> {
  const name = sanitizeFilename(fileName);
  const extension = extname(name).toLowerCase();
  const mimeType = mimeTypeFor(extension);
  if (!mimeType) {
    throw new GeneratedFileError(
      `'${name}' does not have a format you can create. Use ${GENERATED_FORMATS_LABEL}.`,
    );
  }
  if (!content.trim()) throw new GeneratedFileError("The file content is empty.");
  if (extension === ".json") {
    try {
      JSON.parse(content);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new GeneratedFileError(`The content is not valid JSON (${detail}).`);
    }
  }

  const isDocx = extension === ".docx";
  const bytes = isDocx
    ? await markdownToDocx(content)
    : new TextEncoder().encode(content);
  if (bytes.length > MAX_FILE_SIZE_BYTES) {
    throw new GeneratedFileError(
      `The file would weigh more than the ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB limit.`,
    );
  }

  const storagePath = await saveAttachment(context.dataDir, bytes, name);
  const row = await context.repo.create({
    chatId: context.chatId ?? null,
    messageId: null,
    executionId: context.executionId ?? null,
    executionHistoryId: context.executionHistoryId ?? null,
    direction: "output",
    originalName: name,
    mimeType,
    sizeBytes: bytes.length,
    storagePath,
    // The Markdown is the Word document's text: no need to extract it back.
    extractedTextPath: isDocx
      ? await saveExtractedText(context.dataDir, content)
      : null,
    status: "ready",
    createdAt: Date.now(),
  });
  context.files.push(row);
  return row;
}
