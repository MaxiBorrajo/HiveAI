import { dirname, join } from "node:path";
import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { ExternalPluginProcessError } from "../../../../core/microkernel/external-plugins/external-plugin-host.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";

const REQUIRED_FILES = ["index.ts", "bee-plugin.ts"];
const MAX_TOTAL_BYTES = 5 * 1024 * 1024; //5MB

export async function handleImportPlugin(
  hive: HiveMicrokernel,
  req: Request,
  headers: Record<string, string>,
): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return ResponseBuilder.error(
      ["Invalid request: expected multipart/form-data."],
      undefined,
      { status: 400, headers },
    );
  }

  const entries = Array.from(form.entries()).filter(
    (entry): entry is [string, File] => entry[1] instanceof File,
  );

  if (entries.length === 0) {
    return ResponseBuilder.error(["No files were uploaded."], undefined, {
      status: 400,
      headers,
    });
  }

  let totalBytes = 0;
  for (const [, file] of entries) totalBytes += file.size;
  if (totalBytes > MAX_TOTAL_BYTES) {
    return ResponseBuilder.error(
      [
        `Upload too large: ${(totalBytes / 1024 / 1024).toFixed(1)}MB exceeds the ${MAX_TOTAL_BYTES / 1024 / 1024}MB limit.`,
      ],
      undefined,
      { status: 413, headers },
    );
  }

  const tempDir = await Deno.makeTempDir({ prefix: "hiveai-plugin-import-" });

  try {
    const presentFiles = new Set<string>();

    for (const [relativePath, file] of entries) {
      const withoutRoot =
        relativePath.split("/").slice(1).join("/") || relativePath;
      const destPath = join(tempDir, withoutRoot);
      if (!destPath.startsWith(tempDir)) {
        continue;
      }

      await Deno.mkdir(dirname(destPath), { recursive: true });
      await Deno.writeFile(destPath, new Uint8Array(await file.arrayBuffer()));
      presentFiles.add(withoutRoot);
    }

    const missing = REQUIRED_FILES.filter((f) => !presentFiles.has(f));
    if (missing.length > 0) {
      return ResponseBuilder.error(
        [`Missing required file(s): ${missing.join(", ")}.`],
        undefined,
        { status: 400, headers },
      );
    }

    const plugin = await hive.importExternalPlugin(tempDir);
    return ResponseBuilder.success(
      { name: plugin.name, description: plugin.description },
      { headers },
    );
  } catch (error) {
    if (error instanceof ExternalPluginProcessError) {
      return ResponseBuilder.error(
        [`Could not start the plugin: ${error.message}`],
        undefined,
        { status: 502, headers },
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error(
      [`Could not import the plugin: ${detail}`],
      undefined,
      { status: 400, headers },
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
}
