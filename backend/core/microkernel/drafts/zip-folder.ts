import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { BlobWriter, ZipWriter } from "@zip-js/zip-js";

// Bundles a folder's .ts files as a .zip, with `folderName` as the
// top-level folder inside — so unzipping next to the "Import Plugin"
// <input webkitdirectory> flow gives it exactly the folder shape that flow
// already expects, with no manual renaming. Shared by draft export (before
// import) and external plugin export (after import) — same folder shape,
// different source directory.
export async function zipTsFolder(dir: string, folderName: string): Promise<Blob> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && e.name.endsWith(".ts"));

  const zipBlobWriter = new BlobWriter("application/zip");
  const zipWriter = new ZipWriter(zipBlobWriter);

  for (const file of files) {
    const content = await readFile(join(dir, file.name));
    await zipWriter.add(`${folderName}/${file.name}`, new Blob([new Uint8Array(content)]).stream());
  }

  await zipWriter.close();
  return zipBlobWriter.getData();
}
