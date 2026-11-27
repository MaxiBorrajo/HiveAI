import { modelOptionId } from "../../../core/ai/providers/model-selection.ts";
import { ollamaToolSupport, ollamaVisionSupport } from "../../../core/ai/providers/tool-support.ts";
import { fetchAvailableModels } from "../../models/use-cases/get-models.ts";
import { fetchCloudModelGroups } from "../../models/use-cases/get-cloud-models.ts";
import type { Candidate } from "../types.ts";

/** Installed Ollama models plus every cloud model of a provider with an API key. */
export async function buildCandidates(): Promise<Candidate[]> {
  const candidates = new Map<string, Candidate>();

  for (const m of await fetchAvailableModels()) {
    const ref = { provider: "ollama", model: m.name } as const;
    candidates.set(modelOptionId(ref), {
      ref,
      label: m.name,
      location: "local",
      vision: ollamaVisionSupport(m.capabilities).status,
      tools: ollamaToolSupport(m.capabilities).status,
      local: {
        sizeBytes: m.sizeBytes,
        paramsBillions: m.parameterCount ? m.parameterCount / 1e9 : null,
        contextLength: m.contextLength || null,
      },
    });
  }

  for (const group of await fetchCloudModelGroups().catch(() => [])) {
    for (const m of group.models) {
      const ref = { provider: group.provider, model: m.name, keyId: group.keyId };
      const id = modelOptionId(ref);
      if (candidates.has(id)) continue; // same model through two keys: keep the first
      candidates.set(id, {
        ref,
        label: m.label ?? m.name,
        location: "cloud",
        // cloud providers do not report vision; the catalog declares it
        vision: "unknown",
        tools: m.toolSupport.status,
      });
    }
  }
  return [...candidates.values()];
}
