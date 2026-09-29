import { InputMappingViolation } from "../types.ts";
import { WorkflowSkeleton } from "./topology-compiler.ts";

const violation = (
  kind: InputMappingViolation["kind"],
  nodeId: string,
  nodeName: string,
  field: string,
  invalidValue: string,
  reason: string,
): InputMappingViolation => ({ kind, nodeId, nodeName, field, invalidValue, reason });

/**
 * Structural checks on the raw skeleton, before it is turned into a graph.
 * Every finding is sent back to the Topology Compiler as retry feedback so
 * the LLM decides how to fix it — nothing here rewrites a node's type or plugin.
 */
export function findSkeletonShapeViolations(skeleton: WorkflowSkeleton): InputMappingViolation[] {
  const violations: InputMappingViolation[] = [];
  const conditionIds = new Set<string>();

  for (const n of skeleton.nodes) {
    const hasPlugins = (n.plugins?.length ?? 0) > 0;

    if (n.type === "plugin") {
      if (!n.pluginId) {
        violations.push(violation(
          "invalid_node_shape", n.id, n.name, "pluginId", "",
          `plugin node "${n.id}" ("${n.name}") has no "pluginId". Set the single plugin it executes, or change its type to "llm" if it needs reasoning.`,
        ));
      }
      if (hasPlugins) {
        violations.push(violation(
          "invalid_node_shape", n.id, n.name, "plugins", n.plugins!.join(","),
          `plugin node "${n.id}" ("${n.name}") must not set "plugins" (that is only for "llm" agent nodes). Use "pluginId" for a single tool call, or change its type to "llm".`,
        ));
      }
    } else if (n.type === "llm") {
      if (n.pluginId) {
        violations.push(violation(
          "invalid_node_shape", n.id, n.name, "pluginId", n.pluginId,
          `llm node "${n.id}" ("${n.name}") must not set "pluginId". To give it tools, list them in "plugins"; to run a single tool call, change its type to "plugin".`,
        ));
      }
    } else if (n.type === "condition") {
      conditionIds.add(n.id);
      if (n.pluginId || hasPlugins) {
        violations.push(violation(
          "invalid_node_shape", n.id, n.name, "pluginId", n.pluginId ?? n.plugins!.join(","),
          `condition node "${n.id}" ("${n.name}") must not set "pluginId" or "plugins" — it only routes on a value.`,
        ));
      }
    }
  }

  for (const e of skeleton.edges) {
    if (conditionIds.has(e.source) && !e.path) {
      violations.push(violation(
        "condition_edge_missing_path", e.source, e.source, "path", "",
        `edge "${e.source}" -> "${e.target}" leaves condition node "${e.source}" without a "path". Set it to "true" or "false".`,
      ));
    }
  }

  return violations;
}
