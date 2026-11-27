import type { ExecutionRepository } from "../../../infrastructure/db/repositories/execution-repository.ts";
import type { HiveConfig } from "../../../core/microkernel/hive-settings.ts";

export interface ModelUsage {
  chat: boolean;
  executions: { id: number; name: string; nodeIds: string[] }[];
}

interface GraphLike {
  nodes?: { id: string; type: string; config?: Record<string, unknown> }[];
}

/** Where a local Ollama model is referenced: the chat's model and LLM nodes of executions. */
export async function findLocalModelUsage(
  executions: ExecutionRepository,
  config: HiveConfig,
  model: string,
): Promise<ModelUsage> {
  const usage: ModelUsage = {
    chat: config.get("modelProvider") === "ollama" && config.get("model") === model,
    executions: [],
  };
  for (const { execution, graph } of await executions.findLatestGraphs()) {
    const nodeIds = ((graph.graph as GraphLike).nodes ?? [])
      .filter((n) =>
        n.type === "llm" && n.config?.model === model &&
        (n.config?.provider ?? "ollama") === "ollama"
      )
      .map((n) => n.id);
    if (nodeIds.length > 0) {
      usage.executions.push({ id: execution.id, name: execution.name, nodeIds });
    }
  }
  return usage;
}
