import { join, extname } from "node:path";
import { mkdir } from "node:fs/promises";

function attachmentsDir(dataDir: string): string {
  return join(dataDir, "attachments");
}

export async function saveAttachment(
  dataDir: string,
  bytes: Uint8Array,
  originalName: string,
): Promise<string> {
  const dir = attachmentsDir(dataDir);
  await mkdir(dir, { recursive: true });

  const ext = extname(originalName);
  const fileName = `${crypto.randomUUID()}${ext}`;
  const storagePath = join("attachments", fileName);

  await Deno.writeFile(join(dataDir, storagePath), bytes);
  return storagePath;
}

export async function saveExtractedText(
  dataDir: string,
  text: string,
): Promise<string> {
  const dir = attachmentsDir(dataDir);
  await mkdir(dir, { recursive: true });

  const fileName = `${crypto.randomUUID()}.txt`;
  const storagePath = join("attachments", fileName);

  await Deno.writeTextFile(join(dataDir, storagePath), text);
  return storagePath;
}

export async function readAttachment(
  dataDir: string,
  storagePath: string,
): Promise<Uint8Array> {
  return await Deno.readFile(join(dataDir, storagePath));
}

export async function readAttachmentText(
  dataDir: string,
  storagePath: string,
): Promise<string> {
  return await Deno.readTextFile(join(dataDir, storagePath));
}

export async function deleteAttachmentFile(
  dataDir: string,
  storagePath: string,
): Promise<void> {
  try {
    await Deno.remove(join(dataDir, storagePath));
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

/**
 * Copies an existing attachment file to a new path with a fresh name, so the
 * copy's lifecycle (e.g. deletion when its owning chat is deleted) is fully
 * independent from the original's.
 */
export async function copyAttachmentFile(
  dataDir: string,
  sourceStoragePath: string,
): Promise<string> {
  const dir = attachmentsDir(dataDir);
  await mkdir(dir, { recursive: true });

  const ext = extname(sourceStoragePath);
  const fileName = `${crypto.randomUUID()}${ext}`;
  const storagePath = join("attachments", fileName);

  await Deno.copyFile(join(dataDir, sourceStoragePath), join(dataDir, storagePath));
  return storagePath;
}
