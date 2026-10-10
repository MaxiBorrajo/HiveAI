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
