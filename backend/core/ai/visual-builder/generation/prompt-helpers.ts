import type { GraphNode } from "../types.ts";

export function describeNeighbor(
  n: GraphNode | undefined,
  nodeDescriptions: Map<string, string>,
): string {
  if (!n) return "none";
  const role = nodeDescriptions.get(n.id) || n.name;
  const plugins = Array.isArray(n.config?.plugins)
    ? (n.config.plugins as string[])
    : [];
  const outputKey = n.config?.outputKey as string | undefined;
  return `"${n.name}" (type: ${n.type}, role: "${role}"${outputKey ? `, outputKey: "${outputKey}"` : ""}${plugins.length ? `, tools: [${plugins.join(", ")}]` : ""})`;
}
