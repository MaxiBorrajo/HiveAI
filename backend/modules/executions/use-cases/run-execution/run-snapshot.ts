import {
  isCloudProvider,
  type ModelRef,
  normalizeModelRef,
} from "../../../../core/ai/providers/types.ts";
import type {
  RunModel,
  RunNodeSnapshot,
  RunOrchestrator,
} from "../../../usage/run-info.ts";
import type { LangGraphAbstraction } from "../../../../core/ai/visual-builder/types.ts";

export type FindKeyAlias = (keyId: string) => Promise<string | undefined>;

async function toRunModel(
  ref: ModelRef,
  findKeyAlias: FindKeyAlias,
): Promise<RunModel> {
  return {
    provider: ref.provider,
    model: ref.model,
    location: isCloudProvider(ref.provider) ? "cloud" : "local",
    keyId: ref.keyId ?? null,
    keyAlias: ref.keyId ? ((await findKeyAlias(ref.keyId)) ?? null) : null,
  };
}

export async function snapshotNodes(
  graph: LangGraphAbstraction,
  findKeyAlias: FindKeyAlias,
): Promise<RunNodeSnapshot[]> {
  const nodes: RunNodeSnapshot[] = [];
  for (const node of graph.nodes) {
    let model: RunModel | null = null;
    if (node.type === "llm" && node.config?.model) {
      const ref = normalizeModelRef(node.config.model, {
        provider: node.config.provider,
        keyId: node.config.keyId,
      });
      if (ref.model) model = await toRunModel(ref, findKeyAlias);
    }
    nodes.push({ id: node.id, name: node.name, type: node.type, model });
  }
  return nodes;
}

export async function resolveOrchestrator(
  recorded: { provider: string; model: string; keyId?: string } | null,
  current: ModelRef,
  findKeyAlias: FindKeyAlias,
): Promise<RunOrchestrator | null> {
  if (recorded?.model) {
    const ref = normalizeModelRef(recorded.model, {
      provider: recorded.provider,
      keyId: recorded.keyId,
    });
    return { ...(await toRunModel(ref, findKeyAlias)), source: "generation" };
  }
  if (!current.model) return null;
  return { ...(await toRunModel(current, findKeyAlias)), source: "current" };
}
