import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { ExternalPluginProcessError } from "../../../../core/microkernel/external-plugins/external-plugin-host.ts";
import { validateDraftPlugin } from "../../../../core/microkernel/drafts/validate-draft.ts";
import { getDraftRepository } from "../../draft-context.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";

export async function handleImportDraft(
  hive: HiveMicrokernel,
  name: string,
  headers: Record<string, string>,
): Promise<Response> {
  const repository = getDraftRepository(hive);
  const record = await repository.get(name);
  if (!record) {
    return ResponseBuilder.error(["Draft not found."], undefined, {
      status: 404,
      headers,
    });
  }

  const validation = await validateDraftPlugin(hive, record.dir);
  if (!validation.valid) {
    return ResponseBuilder.error(
      ["Draft does not pass validation yet."],
      { issues: validation.issues },
      { status: 422, headers },
    );
  }

  try {
    const plugin = await hive.importExternalPlugin(record.dir);
    await repository.remove(name);
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
  }
}
