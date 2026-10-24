import type { ModelRef } from "../ai/providers/types.ts";
import { isCloudProvider } from "../ai/providers/types.ts";
import { ollamaVisionSupport } from "../ai/providers/tool-support.ts";
import { fetchModelInfo } from "../../modules/models/use-cases/get-model-info.ts";

/**
 * Cloud vision support is a static allowlist rather than a live API lookup:
 * every current Claude 3+ and Gemini model accepts image input, so a per-call
 * check isn't worth the extra request. Revisit if a provider ships a
 * text-only model under the same family name.
 */
function cloudModelSupportsVision(model: string): boolean {
  const name = model.toLowerCase();
  return name.includes("claude") || name.includes("gemini");
}

export async function modelSupportsVision(ref: ModelRef): Promise<boolean> {
  if (isCloudProvider(ref.provider)) {
    return cloudModelSupportsVision(ref.model);
  }
  const info = await fetchModelInfo(ref.model);
  if (!info) return false;
  return ollamaVisionSupport(info.capabilities).status === "supported";
}
