/**
 * Publishers whose popular, tool-capable GGUF builds are added to "Recommended" at runtime,
 * so the list keeps up with new models without anyone editing it.
 */
export const TRUSTED_AUTHORS = ["unsloth", "bartowski", "lmstudio-community", "ggml-org"];

/** Curated starting points that always lead "Recommended", and the list shown when Hugging Face is unreachable. */
export const RECOMMENDED_REPOS = [
  "unsloth/Qwen3-8B-GGUF",
  "unsloth/Qwen3-4B-GGUF",
  "unsloth/Qwen3-1.7B-GGUF",
  "unsloth/Qwen3-0.6B-GGUF",
  "unsloth/Llama-3.2-3B-Instruct-GGUF",
  "unsloth/gemma-3n-E4B-it-GGUF",
  "unsloth/Qwen3-14B-GGUF",
];

/** Static facts used when the Hub cannot be queried at all. */
export const OFFLINE_RECOMMENDED = [
  { id: "unsloth/Qwen3-8B-GGUF", params: 8.2, context: 40960, tools: true },
  { id: "unsloth/Qwen3-4B-GGUF", params: 4.0, context: 40960, tools: true },
  { id: "unsloth/Qwen3-1.7B-GGUF", params: 1.7, context: 40960, tools: true },
  { id: "unsloth/Qwen3-0.6B-GGUF", params: 0.6, context: 40960, tools: true },
  { id: "unsloth/Llama-3.2-3B-Instruct-GGUF", params: 3.2, context: 131072, tools: true },
];
