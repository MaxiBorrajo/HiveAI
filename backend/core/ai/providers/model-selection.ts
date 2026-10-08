import { type ModelRef, PROVIDER_LABELS } from "./types.ts";

export interface ModelOption {
  id: string;
  ref: ModelRef;
  label: string;
  capabilities: string[];
  location?: "local" | "cloud";
  contextLength?: number;
}

export interface ModelSelection {
  orchestrator: ModelRef;
  catalog: ModelOption[];
}

export function modelOptionId(ref: ModelRef): string {
  return `${ref.provider}:${ref.model}`;
}

const formatContext = (n: number) =>
  n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);

export function describeCatalog(selection: ModelSelection): string {
  return selection.catalog
    .map((o) => {
      const details = [
        o.location ?? PROVIDER_LABELS[o.ref.provider],
        o.label,
        o.contextLength ? `ctx ${formatContext(o.contextLength)}` : "",
      ].filter(Boolean);
      const caps = o.capabilities.length ? ` [${o.capabilities.join(", ")}]` : "";
      return `- ${o.id} — ${details.join(", ")}${caps}`;
    })
    .join("\n");
}

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

export function modelConfigFields(ref: ModelRef): {
  model: string;
  provider?: string;
  keyId?: string;
} {
  return ref.provider === "ollama"
    ? { model: ref.model }
    : { model: ref.model, provider: ref.provider, keyId: ref.keyId };
}
