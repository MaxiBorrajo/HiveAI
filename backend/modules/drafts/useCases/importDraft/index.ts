import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { ExternalPluginProcessError } from "../../../../core/microkernel/external-plugins/external-plugin-host.ts";
import { validateDraftPlugin } from "../../../../core/microkernel/drafts/validate-draft.ts";
import { getDraftRepository } from "../../draft-context.ts";

// Promotes a draft to a real, importable external plugin (see
// hive-microkernel.ts's importExternalPlugin) and removes the draft — from
// here on it's tracked by ExternalPluginRegistry, not DraftPluginRepository.
export async function handleImportDraft(
  hive: HiveMicrokernel,
  name: string,
  headers: Record<string, string>,
): Promise<Response> {
  const repository = getDraftRepository(hive);
  const record = await repository.get(name);
  if (!record) {
    return Response.json({ error: "Draft not found." }, { status: 404, headers });
  }

  const validation = await validateDraftPlugin(hive, record.dir);
  if (!validation.valid) {
    return Response.json(
      { error: "Draft does not pass validation yet.", issues: validation.issues },
      { status: 422, headers },
    );
  }

  try {
    const plugin = await hive.importExternalPlugin(record.dir);
    await repository.remove(name);
    return Response.json({ name: plugin.name, description: plugin.description }, { headers });
  } catch (error) {
    if (error instanceof ExternalPluginProcessError) {
      return Response.json(
        { error: `Could not start the plugin: ${error.message}` },
        { status: 502, headers },
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    return Response.json({ error: `Could not import the plugin: ${detail}` }, { status: 400, headers });
  }
}
