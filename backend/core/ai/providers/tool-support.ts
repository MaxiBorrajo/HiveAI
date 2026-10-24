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

export const isSelectable = (support: ToolSupport | undefined): boolean =>
  support?.status !== "unsupported";

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

const VISION_SUPPORTED: ToolSupport = { status: "supported" };

export function ollamaVisionSupport(capabilities: string[]): ToolSupport {
  const caps = capabilities.map((c) => c.toLowerCase());
  if (caps.length === 0) {
    return toolsUnknown("Ollama did not report this model's capabilities.");
  }
  if (caps.includes("vision")) return VISION_SUPPORTED;
  return toolsUnsupported("This model does not support image input.");
}
