import { getCurrentModelRef } from "../../../../core/ai/providers/current-model.ts";
import {
  isCloudProvider,
  isModelProvider,
  type ModelRef,
  PROVIDER_LABELS,
} from "../../../../core/ai/providers/types.ts";
import type { ToolSupport } from "../../../../core/ai/providers/tool-support.ts";
import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import type { LangGraphAbstraction } from "../../../../core/ai/visual-builder/types.ts";
import { getSecretStore } from "../../../../core/secrets/index.ts";
import { getORM } from "../../../../infrastructure/db/orm.ts";
import { ApiKeyRepository } from "../../../../infrastructure/db/repositories/api-key-repository.ts";
import { fetchAvailableModels } from "../../../models/use-cases/get-models.ts";
import { resolveToolSupport } from "../../../models/use-cases/resolve-tool-support.ts";

export interface ModelProblem {
  nodeId: string;
  nodeName: string;
  reason: string;
}

export interface ModelCheckResult {
  problems: ModelProblem[];
  // Allowed, but worth showing: the provider does not say if tools work.
  warnings: ModelProblem[];
}

export interface ModelCheckDeps {
  findKeyAlias: (keyId: string) => Promise<string | undefined>;
  listLocalModels: () => Promise<Set<string> | null>;
  toolSupport: (ref: ModelRef) => Promise<ToolSupport>;
}

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

export async function checkGraphModels(
  graph: LangGraphAbstraction,
  deps: ModelCheckDeps,
): Promise<ModelCheckResult> {
  const problems: ModelProblem[] = [];
  const warnings: ModelProblem[] = [];
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
        continue;
      }
      if (!(await deps.findKeyAlias(keyId))) {
        fail(
          `Node "${node.name}" uses ${label} model '${model}' with an API key that no longer exists. Choose another key.`,
        );
        continue;
      }
    } else {
      local ??= await deps.listLocalModels();
      if (local && !local.has(model)) {
        fail(`Node "${node.name}" uses local model '${model}', which is not installed.`);
        continue;
      }
    }

    const support = await deps.toolSupport({ provider, model, keyId });
    if (support.status === "unsupported") {
      fail(
        `Node "${node.name}" uses '${model}', which cannot be used: ${support.reason ?? "it does not support tool calling."} Choose another model for this node.`,
      );
    } else if (support.status === "unknown") {
      warnings.push({
        nodeId: node.id,
        nodeName: node.name,
        reason: `Node "${node.name}": tool support of '${model}' could not be verified. ${support.reason ?? ""}`.trim(),
      });
    }
  }
  return { problems, warnings };
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
    toolSupport: (ref) => resolveToolSupport(ref),
  };
}
