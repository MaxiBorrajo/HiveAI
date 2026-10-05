import { type ModelRef, PROVIDER_LABELS } from "./types.ts";

export interface ModelOption {
  /** Stable id shown to the orchestrator, e.g. "anthropic:claude-sonnet-5-5". */
  id: string;
  ref: ModelRef;
  label: string;
  capabilities: string[];
}

/** What HiveQueen can choose from when proposing a model per node. */
export interface ModelSelection {
  orchestrator: ModelRef;
  catalog: ModelOption[];
}

export function modelOptionId(ref: ModelRef): string {
  return `${ref.provider}:${ref.model}`;
}

export function describeCatalog(selection: ModelSelection): string {
  return selection.catalog
    .map(
      (o) =>
        `- ${o.id} — ${PROVIDER_LABELS[o.ref.provider]}${o.label ? `, ${o.label}` : ""}${o.capabilities.length ? ` [${o.capabilities.join(", ")}]` : ""}`,
    )
    .join("\n");
}

/** The orchestrator model is the default for every node unless a valid choice is proposed. */
export function resolveNodeModel(
  choice: string | undefined,
  selection: ModelSelection | undefined,
): ModelRef | undefined {
  if (!selection) return undefined;
  const found = choice
    ? selection.catalog.find((o) => o.id === choice.trim())
    : undefined;
  return found?.ref ?? selection.orchestrator;
}

/** Fields to store in an llm node config for a given model reference. */
export function modelConfigFields(ref: ModelRef): {
  model: string;
  provider?: string;
  keyId?: string;
} {
  return ref.provider === "ollama"
    ? { model: ref.model }
    : { model: ref.model, provider: ref.provider, keyId: ref.keyId };
}
