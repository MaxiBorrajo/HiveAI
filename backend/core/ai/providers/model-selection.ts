import { type ModelRef, PROVIDER_LABELS } from "./types.ts";
import type { ToolSupport } from "./tool-support.ts";

export interface ModelOption {
  id: string;
  ref: ModelRef;
  label: string;
  capabilities: string[];
  toolSupport?: ToolSupport;
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
        o.location === "local"
          ? "local, free"
          : o.location === "cloud"
            ? `cloud ${PROVIDER_LABELS[o.ref.provider]}, paid`
            : PROVIDER_LABELS[o.ref.provider],
        o.label,
        o.contextLength ? `ctx ${formatContext(o.contextLength)}` : "",
      ].filter(Boolean);
      const caps = [
        ...o.capabilities,
        ...(o.toolSupport?.status === "unknown" ? ["tools: unverified"] : []),
      ];
      const capsText = caps.length ? ` [${caps.join(", ")}]` : "";
      return `- ${o.id} — ${details.join(", ")}${capsText}`;
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
