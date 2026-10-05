import type { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import { getCurrentModelRef } from "../../../core/ai/providers/current-model.ts";
import {
  type ModelOption,
  type ModelSelection,
  modelOptionId,
} from "../../../core/ai/providers/model-selection.ts";
import type { ModelRef } from "../../../core/ai/providers/types.ts";
import { fetchAvailableModels } from "./get-models.ts";
import { fetchCloudModelGroups } from "./get-cloud-models.ts";

const MAX_CLOUD_MODELS_PER_PROVIDER = 8;

function option(ref: ModelRef, label: string, capabilities: string[]): ModelOption {
  return { id: modelOptionId(ref), ref, label, capabilities };
}

/**
 * Orchestrator = the model selected in chat. The catalog is every local model
 * plus the models of each cloud provider (one key per provider: the
 * orchestrator's key when it matches, otherwise the first one).
 */
export async function buildModelSelection(
  hive: HiveMicrokernel,
): Promise<ModelSelection> {
  const orchestrator = getCurrentModelRef(hive.getConfig());
  const catalog: ModelOption[] = [];

  for (const m of await fetchAvailableModels()) {
    catalog.push(
      option(
        { provider: "ollama", model: m.name },
        m.parameterSize ? `${m.parameterSize} local` : "local",
        m.capabilities,
      ),
    );
  }

  const chosenKey = new Map<string, string>();
  for (const group of await fetchCloudModelGroups()) {
    const preferred =
      orchestrator.provider === group.provider &&
      orchestrator.keyId === group.keyId;
    if (!chosenKey.has(group.provider) || preferred) {
      chosenKey.set(group.provider, group.keyId);
    }
  }
  for (const group of await fetchCloudModelGroups()) {
    if (chosenKey.get(group.provider) !== group.keyId) continue;
    for (const m of group.models.slice(0, MAX_CLOUD_MODELS_PER_PROVIDER)) {
      catalog.push(
        option(
          { provider: group.provider, model: m.name, keyId: group.keyId },
          m.label ?? "cloud",
          m.capabilities,
        ),
      );
    }
  }

  if (orchestrator.model && !catalog.some((o) => o.id === modelOptionId(orchestrator))) {
    catalog.unshift(option(orchestrator, "selected in chat", []));
  }
  return { orchestrator, catalog };
}
