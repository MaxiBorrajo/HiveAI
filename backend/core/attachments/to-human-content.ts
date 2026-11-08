import type { AttachmentContentPart } from "./build-attachment-content.ts";

/**
 * Builds the content of a human message from its text and attachments. Images
 * go as `image_url` because it is the one shape the Anthropic, Gemini and
 * Ollama integrations all accept.
 */
export function toHumanContent(
  text: string,
  parts: AttachmentContentPart[],
): Array<Record<string, unknown>> {
  return [
    { type: "text", text },
    ...parts.map((part) =>
      part.type === "image"
        ? {
          type: "image_url",
          image_url: { url: `data:${part.mimeType};base64,${part.data}` },
        }
        : part
    ),
  ];
}
