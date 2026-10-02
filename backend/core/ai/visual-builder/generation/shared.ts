import { z } from "zod";
import type { GraphNode } from "../types.ts";


export function stateKeySchema(
  availableStateKeys: string[],
  enumDescription: string,
  fallbackDescription: string,
) {
  const validKeys = availableStateKeys.filter((k) => k && k.trim().length > 0);
  return validKeys.length > 0
    ? z
        .enum(validKeys as [string, ...string[]])
        .describe(`${enumDescription} [${validKeys.join(", ")}]`)
    : z.string().describe(fallbackDescription);
}

export function resolveOutputKey(
  node: GraphNode,
  configuredKey: string | undefined,
  suffix: string,
  intermediateNodes: GraphNode[],
): string {
  const fallback = `${node.id}${suffix}`;
  const outKey = configuredKey || fallback;
  const isLastIntermediate =
    intermediateNodes[intermediateNodes.length - 1]?.id === node.id;
  return outKey === "result" && !isLastIntermediate ? fallback : outKey;
}
