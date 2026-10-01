import type { LangGraphAbstraction } from "@/types/execution";

const INPUT_PLACEHOLDER = "${input}";

export function graphRequiresInput(graph: LangGraphAbstraction | null): boolean {
  if (!graph) return false;

  const schemaRequiresInput = Object.entries(graph.stateSchema ?? {}).some(
    ([key, def]) => key === "input" && def.required === true,
  );
  if (schemaRequiresInput) return true;

  return (graph.nodes ?? []).some((node) => {
    if (node.type === "plugin") {
      const mapping = (node.config?.inputMapping || {}) as Record<string, unknown>;
      return Object.values(mapping).some(
        (v) =>
          typeof v === "string" &&
          (v === "input" || v.includes(INPUT_PLACEHOLDER)),
      );
    }
    if (node.type === "llm") {
      const prompt = String(node.config?.systemPrompt || "");
      return (
        prompt.includes(INPUT_PLACEHOLDER) ||
        prompt.includes("input message") ||
        prompt.includes("input ticket")
      );
    }
    return false;
  });
}
