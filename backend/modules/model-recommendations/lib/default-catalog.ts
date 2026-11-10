import type { Catalog } from "../types.ts";

const GB = 1024 ** 3;

/**
 * Built-in catalog. The user can override or extend it, without touching
 * code, in ~/.hiveai/config/model-catalog.json (see catalog-store.ts).
 *
 * Scores are hand-curated starting points, not measurements: when eval
 * results exist for a model they are blended in. REVIEW them against your
 * own experience and the providers' current model lineup.
 */
export const DEFAULT_CATALOG: Catalog = {
  version: 1,
  evalMapping: {
    summarization: ["summarization"],
    tools: ["routing", "param-extraction", "execution"],
  },
  typicalTokens: {
    chat: { input: 1500, output: 500 },
    code: { input: 3000, output: 1500 },
    summarization: { input: 6000, output: 600 },
    documents_data: { input: 10000, output: 1000 },
    reasoning: { input: 2000, output: 2500 },
    vision: { input: 2000, output: 500 },
    tools: { input: 4000, output: 400 },
  },
  entries: [
    {
      provider: "ollama",
      match: "qwen3",
      label: "Qwen3",
      capabilities: { tools: true },
      tasks: {
        chat: { score: 0.75, reason: "Solid general assistant that runs free on your machine." },
        code: { score: 0.7, reason: "Good code help locally, no cost." },
        summarization: { score: 0.72, reason: "Handles summaries well and costs nothing." },
        documents_data: { score: 0.65, reason: "Decent for documents if they fit its context." },
        reasoning: { score: 0.7, reason: "Has a thinking mode for step-by-step problems." },
        tools: { score: 0.78, reason: "Reliable tool calling for a local model." },
      },
      install: { ref: "qwen3:8b", sizeBytes: 5.2 * GB, paramsBillions: 8, contextLength: 40960 },
    },
    {
      provider: "ollama",
      match: "qwen2.5-coder",
      label: "Qwen2.5 Coder",
      capabilities: { tools: true },
      tasks: {
        code: { score: 0.85, reason: "Code-specialised model: strong at writing and fixing code, free." },
        tools: { score: 0.6, reason: "Can call tools, but it is tuned for code." },
      },
      install: { ref: "qwen2.5-coder:7b", sizeBytes: 4.7 * GB, paramsBillions: 7, contextLength: 32768 },
    },
    {
      provider: "ollama",
      match: "llama3.1",
      label: "Llama 3.1",
      capabilities: { tools: true },
      tasks: {
        chat: { score: 0.72, reason: "Well-rounded local chat model." },
        summarization: { score: 0.7, reason: "Good at summaries with a long context window." },
        documents_data: { score: 0.68, reason: "Long context makes it usable on documents." },
        tools: { score: 0.65, reason: "Supports tool calling." },
      },
      install: { ref: "llama3.1:8b", sizeBytes: 4.9 * GB, paramsBillions: 8, contextLength: 131072 },
    },
    {
      provider: "ollama",
      match: "gemma3",
      label: "Gemma 3",
      capabilities: { vision: true },
      tasks: {
        vision: { score: 0.7, reason: "Reads images locally at no cost." },
        chat: { score: 0.68, reason: "Capable small chat model." },
        summarization: { score: 0.68, reason: "Compact and good at summaries." },
      },
      install: { ref: "gemma3:4b", sizeBytes: 3.3 * GB, paramsBillions: 4, contextLength: 131072 },
    },
    {
      provider: "ollama",
      match: "llama3.2-vision",
      label: "Llama 3.2 Vision",
      capabilities: { vision: true },
      tasks: {
        vision: { score: 0.72, reason: "Vision model: describes and analyses images locally." },
      },
      install: { ref: "llama3.2-vision:11b", sizeBytes: 7.8 * GB, paramsBillions: 11, contextLength: 131072 },
    },
    {
      provider: "ollama",
      match: "deepseek-r1",
      label: "DeepSeek R1",
      tasks: {
        reasoning: { score: 0.8, reason: "Reasoning model: strong on multi-step problems, free locally." },
        code: { score: 0.65, reason: "Reasons through code problems, slower than chat models." },
      },
      install: { ref: "deepseek-r1:8b", sizeBytes: 5.2 * GB, paramsBillions: 8, contextLength: 131072 },
    },
    {
      provider: "anthropic",
      match: "claude-opus",
      label: "Claude Opus",
      capabilities: { vision: true, tools: true },
      tasks: {
        reasoning: { score: 0.98, reason: "Top-tier reasoning for hard problems; the most expensive option." },
        code: { score: 0.95, reason: "Best for large or tricky code changes." },
        documents_data: { score: 0.93, reason: "Excellent on long, dense documents." },
        vision: { score: 0.9, reason: "Strong image understanding." },
        tools: { score: 0.93, reason: "Very reliable multi-step tool use." },
      },
    },
    {
      provider: "anthropic",
      match: "claude-sonnet",
      label: "Claude Sonnet",
      capabilities: { vision: true, tools: true },
      tasks: {
        chat: { score: 0.9, reason: "Excellent all-rounder at a moderate price." },
        code: { score: 0.92, reason: "Very strong at code for its price." },
        summarization: { score: 0.9, reason: "High-quality summaries." },
        documents_data: { score: 0.9, reason: "Strong on documents and data." },
        reasoning: { score: 0.9, reason: "Strong reasoning at a lower price than Opus." },
        vision: { score: 0.88, reason: "Good image understanding." },
        tools: { score: 0.92, reason: "Reliable tool calling." },
      },
    },
    {
      provider: "anthropic",
      match: "claude-haiku",
      label: "Claude Haiku",
      capabilities: { vision: true, tools: true },
      tasks: {
        chat: { score: 0.78, reason: "Fast and cheap for everyday questions." },
        summarization: { score: 0.8, reason: "Cheap and good enough for most summaries." },
        tools: { score: 0.8, reason: "Cheap, fast tool calling for simple flows." },
        vision: { score: 0.75, reason: "Cheap image reading for simple cases." },
        code: { score: 0.75, reason: "Fine for small code tasks at low cost." },
      },
    },
    {
      provider: "google",
      match: "gemini-2.5-pro",
      label: "Gemini 2.5 Pro",
      capabilities: { vision: true, tools: true },
      tasks: {
        reasoning: { score: 0.93, reason: "Strong reasoning with a very large context." },
        documents_data: { score: 0.93, reason: "Very large context: good for big documents." },
        code: { score: 0.88, reason: "Strong at code." },
        vision: { score: 0.88, reason: "Strong multimodal understanding." },
        tools: { score: 0.85, reason: "Good tool calling." },
      },
    },
    {
      provider: "google",
      match: "gemini-2.5-flash",
      label: "Gemini 2.5 Flash",
      capabilities: { vision: true, tools: true },
      tasks: {
        chat: { score: 0.82, reason: "Fast and inexpensive for general use." },
        summarization: { score: 0.85, reason: "Cheap summaries over long inputs." },
        documents_data: { score: 0.8, reason: "Large context at a low price." },
        vision: { score: 0.8, reason: "Cheap image understanding." },
        tools: { score: 0.8, reason: "Good tool calling at low cost." },
        code: { score: 0.78, reason: "Capable and cheap for everyday code." },
      },
    },
    {
      provider: "google",
      match: "gemini-2.5-flash-lite",
      label: "Gemini 2.5 Flash-Lite",
      capabilities: { vision: true, tools: true },
      tasks: {
        chat: { score: 0.7, reason: "Cheapest cloud option for simple questions." },
        summarization: { score: 0.72, reason: "Very cheap for routine summaries." },
        tools: { score: 0.68, reason: "Very cheap tool calling for simple flows." },
      },
    },
  ],
};
