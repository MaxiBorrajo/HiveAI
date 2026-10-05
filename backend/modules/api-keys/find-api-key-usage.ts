import type { ExecutionRepository } from "../../infrastructure/db/repositories/execution-repository.ts";
import type { HiveConfig } from "../../core/microkernel/hive-settings.ts";
import type { ApiKeyUsage } from "./api-key-service.ts";

interface GraphLike {
  nodes?: { id: string; type: string; config?: Record<string, unknown> }[];
}

export function createUsageFinder(
  executions: ExecutionRepository,
  config: HiveConfig,
) {
  return async (keyId: string): Promise<ApiKeyUsage> => {
    const usage: ApiKeyUsage = {
      chat: config.get("modelKeyId") === keyId,
      executions: [],
    };

    for (const { execution, graph } of await executions.findLatestGraphs()) {
      const nodeIds = ((graph.graph as GraphLike).nodes ?? [])
        .filter((n) => n.type === "llm" && n.config?.keyId === keyId)
        .map((n) => n.id);
      if (nodeIds.length > 0) {
        usage.executions.push({
          id: execution.id,
          name: execution.name,
          nodeIds,
        });
      }
    }
    return usage;
  };
}
