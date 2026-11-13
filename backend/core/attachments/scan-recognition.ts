import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadScanImage, type ScanState } from "./scanned-content.ts";
import { scheduleAttachmentIndexing } from "./attachment-index.ts";
import type { AttachmentRepository } from "../../infrastructure/db/repositories/attachment-repository.ts";

export type Recognize = (image: Uint8Array) => Promise<string>;
export type WithOcrEngine = <T>(
  dataDir: string,
  use: (recognize: Recognize) => Promise<T>,
) => Promise<T>;

const OCR_LANGUAGES = ["spa", "eng"];
// Small print needs more pixels than a screen does.
const OCR_RENDER_SCALE = 2;
// Long enough to download the language data (about 9MB) the first time.
const ENGINE_START_TIMEOUT_MS = 120_000;

/**
 * Tesseract runs locally. Its language data is downloaded once into the data
 * folder and read from there afterwards, so OCR then works offline.
 */
export const withTesseract: WithOcrEngine = async (dataDir, use) => {
  const cachePath = join(dataDir, "ocr");
  await mkdir(cachePath, { recursive: true });
  const { createWorker } = await import("tesseract.js");
  let worker: Awaited<ReturnType<typeof createWorker>>;
  // Tesseract reports a failed language download here and keeps waiting
  // instead of rejecting, which would leave the file and the queue stuck.
  let reportError: (error: unknown) => void = () => {};
  const failed = new Promise<never>((_, reject) => (reportError = reject));
  failed.catch(() => {});
  const starting = createWorker(OCR_LANGUAGES, 1, {
    cachePath,
    errorHandler: (error: unknown) => reportError(error),
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    worker = await Promise.race([
      starting,
      failed,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`it did not start within ${ENGINE_START_TIMEOUT_MS / 1000}s`)),
          ENGINE_START_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    starting.then((late) => late.terminate()).catch(() => {});
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `the text recognition engine could not start; the first time it needs internet to download its language data (${detail})`,
    );
  } finally {
    clearTimeout(timer);
  }
  try {
    return await use(async (image) => (await worker.recognize(image)).data.text);
  } finally {
    await worker.terminate();
  }
};

/** Reads every source not read yet, saving progress after each one. */
export async function recognizeAttachment(
  dataDir: string,
  repo: AttachmentRepository,
  id: number,
  withEngine: WithOcrEngine,
): Promise<void> {
  const row = await repo.findById(id);
  if (!row?.scan || row.scan.status === "done") return;
  const scan: ScanState = {
    ...row.scan,
    texts: { ...row.scan.texts },
    status: "pending",
    error: undefined,
  };
  await repo.updateScan(id, scan);

  try {
    await withEngine(dataDir, async (recognize) => {
      for (const source of scan.sources) {
        if (scan.texts[source.key] !== undefined) continue;
        // The user can delete the file while it is being read.
        if (!(await repo.findById(id))) return;
        try {
          const image = await loadScanImage(dataDir, row, source, OCR_RENDER_SCALE);
          scan.texts[source.key] = (await recognize(image.bytes)).trim();
        } catch (error) {
          console.error(`[Attachments] Could not read ${source.label} of attachment ${id}:`, error);
          scan.texts[source.key] = "";
        }
        await repo.updateScan(id, scan);
      }
    });
    scan.status = "done";
  } catch (error) {
    scan.status = "failed";
    scan.error = error instanceof Error ? error.message : String(error);
  }
  await repo.updateScan(id, scan);
}

const scheduled = new Set<number>();
let queue: Promise<void> = Promise.resolve();

/**
 * Reads one file at a time in the background. A chat file is then indexed
 * again, so search finds the recognized text.
 */
export function scheduleAttachmentRecognition(
  dataDir: string,
  repo: AttachmentRepository,
  id: number,
): void {
  if (scheduled.has(id)) return;
  scheduled.add(id);
  queue = queue
    .then(async () => {
      await recognizeAttachment(dataDir, repo, id, withTesseract);
      const row = await repo.findById(id);
      if (row?.scan?.status === "done" && row.executionId === null) {
        await repo.resetIndex(id);
        scheduleAttachmentIndexing(dataDir, repo, id);
      }
    })
    .catch((error) =>
      console.error(`[Attachments] Could not read the images of attachment ${id}:`, error)
    )
    .finally(() => {
      scheduled.delete(id);
    });
}

/** Resumes reads cut short by a restart, and retries the failed ones. */
export async function ensureScansRead(
  dataDir: string,
  repo: AttachmentRepository,
  ids: number[],
): Promise<void> {
  for (const id of ids) {
    const row = await repo.findById(id);
    if (row?.scan && row.scan.status !== "done") {
      scheduleAttachmentRecognition(dataDir, repo, id);
    }
  }
}
