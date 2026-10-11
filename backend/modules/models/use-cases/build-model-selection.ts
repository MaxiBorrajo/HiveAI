import type { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import { getCurrentModelRef } from "../../../core/ai/providers/current-model.ts";
import {
  type ModelOption,
  type ModelSelection,
  modelOptionId,
} from "../../../core/ai/providers/model-selection.ts";
import type { ModelRef } from "../../../core/ai/providers/types.ts";
import { isSelectable } from "../../../core/ai/providers/tool-support.ts";
import { buildModelOptionGroups, type ModelOptionGroup } from "./build-model-options.ts";

const MAX_CLOUD_MODELS_PER_PROVIDER = 8;

export async function buildModelSelection(
  hive: HiveMicrokernel,
): Promise<ModelSelection> {
  return selectCatalog(
    await buildModelOptionGroups(),
    getCurrentModelRef(hive.getConfig()),
  );
}

export function selectCatalog(
  groups: ModelOptionGroup[],
  orchestrator: ModelRef,
): ModelSelection {
  const catalog: ModelOption[] = [];

  const chosenKey = new Map<string, string>();
  for (const g of groups) {
    const ref = g.options[0]?.ref;
    if (!ref?.keyId) continue;
    const preferred =
      orchestrator.provider === ref.provider && orchestrator.keyId === ref.keyId;
    if (!chosenKey.has(ref.provider) || preferred) {
      chosenKey.set(ref.provider, ref.keyId);
    }
  }

  // The generator may only hand a node a model that can take its tools.
  for (const g of groups) {
    const ref = g.options[0]?.ref;
    if (!ref) continue;
    const usable = g.options.filter((o) => isSelectable(o.toolSupport));
    if (!ref.keyId) {
      catalog.push(...usable);
    } else if (chosenKey.get(ref.provider) === ref.keyId) {
      catalog.push(...usable.slice(0, MAX_CLOUD_MODELS_PER_PROVIDER));
    }
  }

  const orchestratorId = modelOptionId(orchestrator);
  if (orchestrator.model && !catalog.some((o) => o.id === orchestratorId)) {
    // Keep what is known about the chat model instead of an empty entry.
    const known = groups
      .flatMap((g) => g.options)
      .find((o) => o.id === orchestratorId && o.ref.keyId === orchestrator.keyId);
    if (isSelectable(known?.toolSupport)) {
      catalog.unshift({
        id: orchestratorId,
        ref: orchestrator,
        label: "selected in chat",
        capabilities: known?.capabilities ?? [],
        ...(known?.toolSupport ? { toolSupport: known.toolSupport } : {}),
      });
    }
  }
  return { orchestrator, catalog };
}
