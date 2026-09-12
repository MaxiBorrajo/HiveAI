import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { BlobWriter, ZipWriter } from "@zip-js/zip-js";

export async function zipTsFolder(
  dir: string,
  folderName: string,
): Promise<Blob> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && e.name.endsWith(".ts"));

  const zipBlobWriter = new BlobWriter("application/zip");
  const zipWriter = new ZipWriter(zipBlobWriter);

  for (const file of files) {
    const content = await readFile(join(dir, file.name));
    await zipWriter.add(
      `${folderName}/${file.name}`,
      new Blob([new Uint8Array(content)]).stream(),
    );
  }

  await zipWriter.close();
  return zipBlobWriter.getData();
}
