import { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import { ExternalPluginProcessError } from "../../../core/microkernel/external-plugins/external-plugin-host.ts";
import { ResponseBuilder } from "../../../core/api/response.ts";
import { stagingDirFor } from "./generate-plugin-draft.ts";

export async function installPluginDraft(
  hive: HiveMicrokernel,
  sessionId: string,
  headers: Record<string, string>,
): Promise<Response> {
  const stagingDir = stagingDirFor(sessionId);

  try {
    await Deno.stat(`${stagingDir}/index.ts`);
  } catch {
    return ResponseBuilder.error(
      ["No generated plugin draft was found for this session."],
      undefined,
      { status: 404, headers },
    );
  }

  try {
    const plugin = await hive.importExternalPlugin(stagingDir);
    await hive.activate(plugin.name);
    await Deno.remove(stagingDir, { recursive: true }).catch(() => {});
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
      [`Could not install the plugin: ${detail}`],
      undefined,
      { status: 400, headers },
    );
  }
}
