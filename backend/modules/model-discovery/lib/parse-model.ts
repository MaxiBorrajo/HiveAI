import type { HfModel, HfTreeEntry } from "./hf-client.ts";
import type { ModelCard, Quantization } from "../types.ts";

const NON_CHAT_PIPELINES = new Set([
  "feature-extraction",
  "sentence-similarity",
  "text-to-image",
  "text-to-speech",
  "automatic-speech-recognition",
  "image-classification",
]);

export function isChatCandidate(model: HfModel): boolean {
  return !model.pipeline_tag || !NON_CHAT_PIPELINES.has(model.pipeline_tag);
}

export function parseModel(model: HfModel): ModelCard {
  const tags = model.tags ?? [];
  const template = model.gguf?.chat_template ?? "";
  const license = tags.find((t) => t.startsWith("license:"))?.slice(8) ?? null;
  return {
    id: model.id,
    ollamaName: `hf.co/${model.id}`,
    paramsBillions: model.gguf?.total
      ? Math.round(model.gguf.total / 1e8) / 10
      : null,
    architecture: model.gguf?.architecture ?? null,
    contextLength: model.gguf?.context_length ?? null,
    downloads: model.downloads ?? 0,
    likes: model.likes ?? 0,
    license,
    capabilities: {
      tools: /\btools?\b/.test(template),
      vision: model.pipeline_tag === "image-text-to-text" ||
        tags.some((t) => t === "multimodal" || t === "vision"),
      reasoning: tags.some((t) => t === "reasoning" || t === "thinking") ||
        template.includes("<think>"),
    },
  };
}

const QUANT_PATTERN =
  /(?<![A-Za-z0-9])(IQ\d_[A-Z]+|Q\d_K_[A-Z]+|Q\d_K|Q\d_\d|BF16|F16|F32|MXFP4)(?![A-Za-z0-9])/i;

export function quantFromFilename(path: string): string | null {
  const file = path.split("/").pop() ?? path;
  const match = QUANT_PATTERN.exec(file);
  return match ? match[1].toUpperCase() : null;
}

/** Sums split files per quantization; skips projector and non-GGUF files. */
export function parseQuantizations(
  repo: string,
  tree: HfTreeEntry[],
): Quantization[] {
  const sizes = new Map<string, number>();
  for (const entry of tree) {
    if (entry.type !== "file" || !entry.path.toLowerCase().endsWith(".gguf")) continue;
    if (/mmproj/i.test(entry.path)) continue;
    const quant = quantFromFilename(entry.path);
    if (!quant) continue;
    sizes.set(quant, (sizes.get(quant) ?? 0) + (entry.size ?? 0));
  }
  return [...sizes]
    .filter(([, sizeBytes]) => sizeBytes > 0)
    .map(([name, sizeBytes]) => ({
      name,
      sizeBytes,
      ollamaName: `hf.co/${repo}:${name}`,
    }))
    .sort((a, b) => a.sizeBytes - b.sizeBytes);
}

/** Approximate bytes of a Q4_K_M build (~4.85 bits per weight). */
export function estimateQ4Bytes(paramsBillions: number | null): number | null {
  return paramsBillions === null ? null : Math.round(paramsBillions * 1e9 * 0.606);
}
