import type { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import type { PluginConfigField } from "../../../core/microkernel/bee-plugin.ts";
import { ResponseBuilder } from "../../../core/api/response.ts";
import {
  handleDeletePluginConfig,
  handleGetPluginConfig,
  handleSetPluginConfig,
} from "../../plugin-config/router-handlers.ts";
import { getDraftRepository } from "../lib/draft-context.ts";

interface DraftConfigInfo {
  pluginName: string;
  fields: PluginConfigField[];
}

/**
 * Drafts are not registered in the hive, so the plugin itself is loaded in a
 * throwaway subprocess just to read its name and config fields. Values land in
 * the same secret store the plugin reads at run time (`<plugin name>:<key>`),
 * so they carry over when the draft is published.
 */
async function inspectDraft(
  hive: HiveMicrokernel,
  draftName: string,
): Promise<DraftConfigInfo | undefined> {
  const record = await getDraftRepository(hive).get(draftName);
  if (!record) return undefined;
  const handle = await hive.probeExternalPlugin(record.dir);
  try {
    return {
      pluginName: handle.plugin.name,
      fields: handle.plugin.configFields ?? [],
    };
  } finally {
    await handle.stop();
  }
}

async function withDraft(
  hive: HiveMicrokernel,
  draftName: string,
  headers: Record<string, string>,
  run: (
    info: DraftConfigInfo,
    resolveFields: () => Promise<PluginConfigField[]>,
  ) => Promise<Response>,
): Promise<Response> {
  let info: DraftConfigInfo | undefined;
  try {
    info = await inspectDraft(hive, draftName);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error(
      [`Could not load the plugin: ${detail}`],
      undefined,
      { status: 400, headers },
    );
  }
  if (!info) {
    return ResponseBuilder.error(["Draft not found."], undefined, {
      status: 404,
      headers,
    });
  }
  const loaded = info;
  return run(loaded, () => Promise.resolve(loaded.fields));
}

export function handleGetDraftConfig(
  hive: HiveMicrokernel,
  draftName: string,
  headers: Record<string, string>,
) {
  return withDraft(hive, draftName, headers, (info, resolve) =>
    handleGetPluginConfig(hive, info.pluginName, headers, resolve));
}

export function handleSetDraftConfig(
  hive: HiveMicrokernel,
  draftName: string,
  key: string,
  request: Request,
  headers: Record<string, string>,
) {
  return withDraft(hive, draftName, headers, (info, resolve) =>
    handleSetPluginConfig(hive, info.pluginName, key, request, headers, resolve));
}

export function handleDeleteDraftConfig(
  hive: HiveMicrokernel,
  draftName: string,
  key: string,
  headers: Record<string, string>,
) {
  return withDraft(hive, draftName, headers, (info, resolve) =>
    handleDeletePluginConfig(hive, info.pluginName, key, headers, resolve));
}
