import type { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import { getCurrentModelRef } from "../../../core/ai/providers/current-model.ts";
import {
  type ModelOption,
  type ModelSelection,
  modelOptionId,
} from "../../../core/ai/providers/model-selection.ts";
import type { ModelRef } from "../../../core/ai/providers/types.ts";
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

  for (const g of groups) {
    const ref = g.options[0]?.ref;
    if (!ref) continue;
    if (!ref.keyId) {
      catalog.push(...g.options);
    } else if (chosenKey.get(ref.provider) === ref.keyId) {
      catalog.push(...g.options.slice(0, MAX_CLOUD_MODELS_PER_PROVIDER));
    }
  }

  if (
    orchestrator.model &&
    !catalog.some((o) => o.id === modelOptionId(orchestrator))
  ) {
    catalog.unshift({
      id: modelOptionId(orchestrator),
      ref: orchestrator,
      label: "selected in chat",
      capabilities: [],
    });
  }
  return { orchestrator, catalog };
}
