import { dirname, join } from "node:path";
import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { ExternalPluginProcessError } from "../../../../core/microkernel/external-plugins/external-plugin-host.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";

const REQUIRED_FILES = ["index.ts", "bee-plugin.ts"];
const MAX_TOTAL_BYTES = 5 * 1024 * 1024; // 5MB — a plugin is source code, not a payload for binary assets.

// The browser's folder picker (<input webkitdirectory>) can't give the
// frontend an absolute filesystem path — for security, browsers never expose
// real paths of user-selected files. So the frontend uploads the folder's
// files as multipart/form-data (each entry's `webkitRelativePath` preserved
// as its form field name) instead of sending a path string. This handler
// writes them to a fresh temp directory that mirrors that structure, then
// hands that off to hive.importExternalPlugin exactly like a path picked on
// the same machine as the backend would be.
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
    return ResponseBuilder.error(
      ["No files were uploaded."],
      undefined,
      { status: 400, headers },
    );
  }

  let totalBytes = 0;
  for (const [, file] of entries) totalBytes += file.size;
  if (totalBytes > MAX_TOTAL_BYTES) {
    return ResponseBuilder.error(
      [`Upload too large: ${(totalBytes / 1024 / 1024).toFixed(1)}MB exceeds the ${MAX_TOTAL_BYTES / 1024 / 1024}MB limit.`],
      undefined,
      { status: 413, headers },
    );
  }

  const tempDir = await Deno.makeTempDir({ prefix: "hiveai-plugin-import-" });

  try {
    const presentFiles = new Set<string>();

    for (const [relativePath, file] of entries) {
      // Strip the folder's own name (the first path segment) so the
      // resulting temp dir's root matches the plugin's actual root — the
      // relative path field name is like "my-plugin/index.ts".
      const withoutRoot = relativePath.split("/").slice(1).join("/") || relativePath;
      const destPath = join(tempDir, withoutRoot);

      // Guard against a malicious/malformed relative path escaping tempDir
      // (e.g. "../../etc/passwd") before ever touching the filesystem.
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
    // The plugin's real, persisted copy lives under HiveMicrokernel's own
    // external-plugins directory (see external-plugin-registry.ts) — this
    // temp dir was only a staging area for the upload.
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
}
