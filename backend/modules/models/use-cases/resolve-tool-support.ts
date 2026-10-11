import type { ModelRef } from "../../../core/ai/providers/types.ts";
import { isCloudProvider } from "../../../core/ai/providers/types.ts";
import {
  ollamaToolSupport,
  type ToolSupport,
  toolsUnknown,
} from "../../../core/ai/providers/tool-support.ts";
import { fetchModelInfo } from "./get-model-info.ts";
import { fetchCloudModelGroups } from "./get-cloud-models.ts";

export interface ToolSupportLookup {
  localCapabilities: (model: string) => Promise<string[] | null>;
  cloudSupport: (
    ref: ModelRef,
  ) => Promise<ToolSupport | undefined>;
}

export const defaultToolSupportLookup: ToolSupportLookup = {
  localCapabilities: async (model) => {
    try {
      return (await fetchModelInfo(model))?.capabilities ?? null;
    } catch {
      return null;
    }
  },
  cloudSupport: async (ref) => {
    const groups = await fetchCloudModelGroups();
    return groups
      .find((g) => g.keyId === ref.keyId)
      ?.models.find((m) => m.name === ref.model)?.toolSupport;
  },
};

// Single place that answers "can this model take tools?" for the chat, the
// nodes and the saved model, always from what the provider reports.
export async function resolveToolSupport(
  ref: ModelRef,
  lookup: ToolSupportLookup = defaultToolSupportLookup,
): Promise<ToolSupport> {
  if (isCloudProvider(ref.provider)) {
    return (
      (await lookup.cloudSupport(ref)) ??
      toolsUnknown("The provider's model list could not be checked.")
    );
  }
  const capabilities = await lookup.localCapabilities(ref.model);
  return capabilities
    ? ollamaToolSupport(capabilities)
    : toolsUnknown("Ollama could not be queried for this model.");
}
