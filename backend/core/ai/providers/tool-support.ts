export type ToolSupportStatus = "supported" | "unsupported" | "unknown";

export interface ToolSupport {
  status: ToolSupportStatus;
  reason?: string;
}

export const TOOLS_SUPPORTED: ToolSupport = { status: "supported" };

export const toolsUnsupported = (reason: string): ToolSupport => ({
  status: "unsupported",
  reason,
});

export const toolsUnknown = (reason: string): ToolSupport => ({
  status: "unknown",
  reason,
});

// Unknown is allowed (with a warning); only a confirmed "no" blocks.
export const isSelectable = (support: ToolSupport | undefined): boolean =>
  support?.status !== "unsupported";

// Ollama reports what each model can do; an empty list means the daemon is
// too old to say, which is not the same as "cannot".
export function ollamaToolSupport(capabilities: string[]): ToolSupport {
  const caps = capabilities.map((c) => c.toLowerCase());
  if (caps.length === 0) {
    return toolsUnknown("Ollama did not report this model's capabilities.");
  }
  if (caps.includes("tools")) return TOOLS_SUPPORTED;
  if (!caps.includes("completion") && caps.includes("embedding")) {
    return toolsUnsupported(
      "Embedding model: it does not generate chat responses.",
    );
  }
  return toolsUnsupported("This model does not support tool calling.");
}
