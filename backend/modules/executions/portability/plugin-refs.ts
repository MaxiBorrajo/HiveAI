import type { LangGraphAbstraction } from "../../../core/ai/visual-builder/types.ts";
import type { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";

/** Names of plugins referenced by plugin nodes and LLM nodes. */
export function collectRequiredPlugins(graph: LangGraphAbstraction): string[] {
  const names = new Set<string>();
  for (const node of graph.nodes) {
    const config = (node.config ?? {}) as Record<string, unknown>;
    if (node.type === "plugin" && typeof config.pluginId === "string") {
      if (config.pluginId) names.add(config.pluginId);
    }
    if (node.type === "llm" && Array.isArray(config.plugins)) {
      for (const p of config.plugins) {
        if (typeof p === "string" && p) names.add(p);
      }
    }
  }
  return [...names];
}

export function findMissingPlugins(
  graph: LangGraphAbstraction,
  hive: HiveMicrokernel,
): string[] {
  return collectRequiredPlugins(graph).filter((n) => !hive.getPlugin(n));
}

export function findInactivePlugins(
  graph: LangGraphAbstraction,
  hive: HiveMicrokernel,
): string[] {
  return collectRequiredPlugins(graph).filter(
    (n) => hive.getPlugin(n) && !hive.isActive(n),
  );
}
