import { getCurrentModelRef } from "../../../../core/ai/providers/current-model.ts";
import {
  isCloudProvider,
  isModelProvider,
  PROVIDER_LABELS,
} from "../../../../core/ai/providers/types.ts";
import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import type { LangGraphAbstraction } from "../../../../core/ai/visual-builder/types.ts";
import { getSecretStore } from "../../../../core/secrets/index.ts";
import { getORM } from "../../../../infrastructure/db/orm.ts";
import { ApiKeyRepository } from "../../../../infrastructure/db/repositories/api-key-repository.ts";
import { fetchAvailableModels } from "../../../models/use-cases/get-models.ts";

export interface ModelProblem {
  nodeId: string;
  nodeName: string;
  reason: string;
}

export interface ModelCheckDeps {
  /** Alias for the key id, or undefined if the key no longer exists. */
  findKeyAlias: (keyId: string) => Promise<string | undefined>;
  /** Names of installed local models, or null if Ollama can't be queried. */
  listLocalModels: () => Promise<Set<string> | null>;
}

/**
 * Fills in the chat model on llm nodes that have none, so a graph never runs
 * with an undefined model. Mutates and returns the given graph.
 */
export function applyDefaultModel(
  graph: LangGraphAbstraction,
  hive: HiveMicrokernel,
): LangGraphAbstraction {
  const current = getCurrentModelRef(hive.getConfig());
  if (!current.model) return graph;
  for (const node of graph.nodes) {
    if (node.type !== "llm" || node.config?.model) continue;
    node.config = {
      ...node.config,
      model: current.model,
      ...(current.provider !== "ollama"
        ? { provider: current.provider, keyId: current.keyId }
        : {}),
    };
  }
  return graph;
}

/** Explains why a graph can't start because of a missing model or key. */
export async function checkGraphModels(
  graph: LangGraphAbstraction,
  deps: ModelCheckDeps,
): Promise<ModelProblem[]> {
  const problems: ModelProblem[] = [];
  let local: Set<string> | null | undefined;

  for (const node of graph.nodes) {
    if (node.type !== "llm") continue;
    const { model, provider = "ollama", keyId } = node.config as {
      model?: string;
      provider?: string;
      keyId?: string;
    };
    const fail = (reason: string) =>
      problems.push({ nodeId: node.id, nodeName: node.name, reason });

    if (!model) {
      fail(`Node "${node.name}" has no model selected.`);
      continue;
    }
    if (!isModelProvider(provider)) {
      fail(`Node "${node.name}" uses an unknown provider '${provider}'.`);
      continue;
    }

    if (isCloudProvider(provider)) {
      const label = PROVIDER_LABELS[provider];
      if (!keyId) {
        fail(`Node "${node.name}" uses ${label} model '${model}' but no API key is selected.`);
      } else if (!(await deps.findKeyAlias(keyId))) {
        fail(
          `Node "${node.name}" uses ${label} model '${model}' with an API key that no longer exists. Choose another key.`,
        );
      }
      continue;
    }

    local ??= await deps.listLocalModels();
    if (local && !local.has(model)) {
      fail(`Node "${node.name}" uses local model '${model}', which is not installed.`);
    }
  }
  return problems;
}

export function defaultModelCheckDeps(): ModelCheckDeps {
  return {
    findKeyAlias: async (keyId) => {
      const row = await new ApiKeyRepository(getORM()).findById(keyId);
      if (!row) return undefined;
      return (await getSecretStore().get(keyId)) ? row.alias : undefined;
    },
    listLocalModels: async () => {
      const models = await fetchAvailableModels();
      return models.length > 0 ? new Set(models.map((m) => m.name)) : null;
    },
  };
}
