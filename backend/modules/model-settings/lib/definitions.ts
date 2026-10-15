import { ModelSettingDefinition } from "../types.ts";

export const MODEL_SETTING_DEFINITIONS: ModelSettingDefinition[] = [
  {
    name: "thinking",
    description:
      "Lets local models reason step by step before answering. Turning it off makes responses much faster at a cost to quality on hard tasks. Does not apply to cloud models.",
    type: "boolean",
    defaultValue: true,
    note: "Applied per request to the local Scout and Sader nodes, no restart needed.",
    requiresServiceRestart: false,
  },
  {
    name: "kv_cache_type",
    description:
      "Quantization type applied to both the Key and Value attention caches. Lower bit precision reduces VRAM and memory bandwidth usage at a cost to precision. Ollama applies a single quantization to K and V together — it cannot be set independently.",
    type: "string",
    defaultValue: "f16",
    options: ["f16", "q8_0", "q4_0"],
    note: "Requires flash_attention to take effect. On CPU-only machines quantized caches (q8_0, q4_0) roughly halved prompt-processing speed in our benchmarks, so f16 is the default; quantize only to save memory. Set via the OLLAMA_KV_CACHE_TYPE environment variable, global to the whole Ollama process — applying a change restarts the Ollama service and affects every model, not just the active one.",
    requiresServiceRestart: true,
  },
  {
    name: "flash_attention",
    description:
      "Enables flash attention, a faster and more memory-efficient attention implementation. Required for KV cache quantization to take effect.",
    type: "boolean",
    defaultValue: true,
    note: "Set via the OLLAMA_FLASH_ATTENTION environment variable, global to the whole Ollama process — applying a change restarts the Ollama service and affects every model, not just the active one.",
    requiresServiceRestart: true,
  },
  {
    name: "n_ctx",
    description:
      "Context window size in tokens, defining the maximum prompt and history length the model can process simultaneously.",
    type: "number",
    defaultValue: 4096,
    minValue: 512,
    maxValue: 131072,
    step: 256,
    requiresServiceRestart: false,
  },
  {
    name: "n_gpu_layers",
    description:
      "Number of model layers to offload to the GPU for hardware acceleration. Set to -1 to let Ollama decide.",
    type: "number",
    defaultValue: -1,
    minValue: -1,
    maxValue: 256,
    step: 1,
    requiresServiceRestart: false,
  },
  {
    name: "n_batch",
    description:
      "Batch size for prompt processing (prefill). Higher values process input prompts faster but consume more memory during ingestion.",
    type: "number",
    defaultValue: 512,
    minValue: 1,
    maxValue: 4096,
    step: 64,
    requiresServiceRestart: false,
  },
  {
    name: "n_threads",
    description:
      "Number of CPU threads to allocate for computation during inference.",
    type: "number",
    defaultValue: null,
    minValue: 1,
    maxValue: 128,
    step: 1,
    note: "When unset, Ollama picks the number of threads itself.",
    requiresServiceRestart: false,
  },
  {
    name: "mmap",
    description:
      "Enables memory-mapping to load the model file directly from disk, reducing startup time and allowing the OS to page weights dynamically.",
    type: "boolean",
    defaultValue: true,
    note: "Disabling mmap forces the full model into non-mapped process memory — on systems without enough free RAM to hold it, this causes heavy swapping and can collapse throughput by an order of magnitude.",
    requiresServiceRestart: false,
  },
  {
    name: "mlock",
    description:
      "Locks model weights in physical RAM, preventing the operating system from paging them to the swap disk and ensuring consistent latency.",
    type: "boolean",
    defaultValue: false,
    note: "Only effective when sufficient free RAM is available.",
    requiresServiceRestart: false,
  },
  {
    name: "keep_alive",
    description:
      "How long the model stays loaded in memory after the last request. Keeping it loaded avoids the cold-start cost of reloading it on the next message.",
    type: "string",
    defaultValue: "30m",
    options: ["5m", "30m", "1h", "24h"],
    note: "Applied per request, no restart needed.",
    requiresServiceRestart: false,
  },
  {
    name: "temperature",
    description:
      "Controls randomness in token selection. Lower values make output more deterministic and focused; higher values produce more diverse and creative responses.",
    type: "number",
    defaultValue: 0.7,
    minValue: 0,
    maxValue: 2,
    step: 0.1,
    requiresServiceRestart: false,
  },
  {
    name: "top_k",
    description:
      "Limits token selection to the K highest-probability tokens at each step, filtering out unlikely choices.",
    type: "number",
    defaultValue: 40,
    minValue: 0,
    maxValue: 100,
    step: 1,
    requiresServiceRestart: false,
  },
  {
    name: "top_p",
    description:
      "Nucleus sampling threshold that restricts token selection to candidates whose cumulative probability reaches P.",
    type: "number",
    defaultValue: 0.9,
    minValue: 0,
    maxValue: 1,
    step: 0.05,
    requiresServiceRestart: false,
  },
  {
    name: "repeat_penalty",
    description:
      "Applies a penalty to recently generated tokens to discourage the model from repeating words, phrases, or patterns.",
    type: "number",
    defaultValue: 1.1,
    minValue: 1,
    maxValue: 1.5,
    step: 0.05,
    requiresServiceRestart: false,
  },
  {
    name: "limit_output",
    description:
      "Dynamically limits the maximum number of output tokens based on the available context and task type.",
    type: "boolean",
    defaultValue: true,
    note: "If true, num_predict is calculated at runtime based on the available n_ctx and task type; if false, num_predict = -1 (unlimited, stopped by EOS).",
    requiresServiceRestart: false,
  },
];
