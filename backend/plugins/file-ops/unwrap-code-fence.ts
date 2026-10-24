const WRAPPING_FENCE = /^\s*```[\w+-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```\s*$/;
const KEEPS_FENCES = /\.(md|markdown|mdx|txt)$/i;

/**
 * LLMs often wrap a whole file in a single Markdown code fence. Written to disk
 * as-is, that makes an .html/.css/.json file invalid, so the fence is removed.
 * Markdown and text files keep it, and content with prose around the fence is untouched.
 */
export function unwrapCodeFence(path: string, content: string): string {
  if (KEEPS_FENCES.test(path)) return content;
  const inner = WRAPPING_FENCE.exec(content)?.[1];
  if (inner === undefined || inner.includes("```")) return content;
  return inner;
}
