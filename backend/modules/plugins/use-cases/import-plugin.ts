import type { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import { ExternalPluginProcessError } from "../../../core/microkernel/external-plugins/external-plugin-host.ts";
import { PluginConformanceError } from "../../../core/microkernel/plugin-conformance.ts";
import {
  pluginFilesFromPluginZip,
  readZip,
  writePluginFiles,
  ZipReadError,
} from "../../../core/files/zip-folder.ts";
import { ResponseBuilder } from "../../../core/api/response.ts";

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

  const upload = form.get("file");
  if (!(upload instanceof File)) {
    return ResponseBuilder.error(["No zip file was uploaded."], undefined, {
      status: 400,
      headers,
    });
  }

  if (upload.size > MAX_TOTAL_BYTES) {
    return ResponseBuilder.error(
      [
        `Upload too large: ${(upload.size / 1024 / 1024).toFixed(1)}MB exceeds the ${MAX_TOTAL_BYTES / 1024 / 1024}MB limit.`,
      ],
      undefined,
      { status: 413, headers },
    );
  }

  let tempDir: string | undefined;
  try {
    const entries = await readZip(
      new Uint8Array(await upload.arrayBuffer()),
      MAX_TOTAL_BYTES,
    );
    const files = pluginFilesFromPluginZip(entries);

    tempDir = await Deno.makeTempDir({ prefix: "hiveai-plugin-import-" });
    await writePluginFiles(tempDir, files);

    const plugin = await hive.importExternalPlugin(tempDir);
    return ResponseBuilder.success(
      { name: plugin.name, description: plugin.description },
      { headers },
    );
  } catch (error) {
    if (error instanceof ZipReadError) {
      return ResponseBuilder.error([error.message], undefined, {
        status: 400,
        headers,
      });
    }
    if (error instanceof PluginConformanceError) {
      return ResponseBuilder.error(error.issues, undefined, {
        status: 422,
        headers,
      });
    }
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
    if (tempDir) await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
}
