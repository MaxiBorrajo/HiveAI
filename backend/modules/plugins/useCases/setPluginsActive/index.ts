import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";
import { getPlugins } from "../getPlugins/index.ts";

export interface PluginActiveChange {
  name: string;
  active: boolean;
}

/**
 * Applies all changes or none. If any plugin fails to activate/deactivate,
 * every change already applied in this batch is rolled back to its
 * pre-batch state before returning, so the reported state never reflects
 * a partial failure.
 */
export async function setPluginsActive(
  hive: HiveMicrokernel,
  changes: PluginActiveChange[],
): Promise<{ ok: true } | { ok: false; failedPlugin: string }> {
  const applied: PluginActiveChange[] = [];

  for (const change of changes) {
    const success = change.active
      ? await hive.activate(change.name)
      : await hive.deactivate(change.name);

    if (!success) {
      for (const previous of applied.reverse()) {
        const wasActive = !previous.active;
        if (wasActive) {
          await hive.activate(previous.name);
        } else {
          await hive.deactivate(previous.name);
        }
      }
      return { ok: false, failedPlugin: change.name };
    }

    applied.push(change);
  }

  return { ok: true };
}

export async function handleSetPluginsActive(
  hive: HiveMicrokernel,
  request: Request,
  headers: Record<string, string>,
): Promise<Response> {
  const body = await request.json().catch(() => null);
  const changes = body?.changes as PluginActiveChange[] | undefined;

  if (!Array.isArray(changes) || changes.length === 0) {
    return ResponseBuilder.error(["No plugin changes provided."], undefined, {
      headers,
      status: 400,
    });
  }

  const result = await setPluginsActive(hive, changes);

  if (!result.ok) {
    return ResponseBuilder.error(
      [
        `Failed to update plugin '${result.failedPlugin}'. No changes were applied.`,
      ],
      getPlugins(hive),
      { headers, status: 409 },
    );
  }

  return ResponseBuilder.success(getPlugins(hive), { headers });
}
