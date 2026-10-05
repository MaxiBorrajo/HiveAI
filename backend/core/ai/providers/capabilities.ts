import type { ModelProvider } from "./types.ts";

const THINKING_PATTERNS: Partial<Record<ModelProvider, RegExp>> = {
  anthropic:
    /claude-(3-7|sonnet-4|opus-4|haiku-4|sonnet-5|opus-5|fable)/i,
  "ollama-cloud": /deepseek|glm|qwen3|gpt-oss|kimi|minimax/i,
};

/** Cloud models known to expose a reasoning/thinking stream. */
export function cloudModelSupportsThinking(
  provider: ModelProvider,
  model: string,
): boolean {
  return THINKING_PATTERNS[provider]?.test(model) ?? false;
}

/**
 * Splits a chat message chunk's content into visible text and thinking text.
 * Handles plain strings (Ollama/OpenAI) and block arrays (Anthropic/Gemini).
 */
export function splitContent(content: unknown): {
  text: string;
  thinking: string;
} {
  if (typeof content === "string") return { text: content, thinking: "" };
  if (!Array.isArray(content)) return { text: "", thinking: "" };

  let text = "";
  let thinking = "";
  for (const block of content) {
    if (typeof block === "string") {
      text += block;
      continue;
    }
    const b = block as { type?: string; text?: string; thinking?: string };
    if (b.type === "thinking" && typeof b.thinking === "string") {
      thinking += b.thinking;
    } else if (typeof b.text === "string" && b.type !== "thinking") {
      text += b.text;
    }
  }
  return { text, thinking };
}
