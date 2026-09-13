export function parseModelJSON<T>(content: string, context?: string): T | null {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\n?/i, "")
    .replace(/```$/, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch (error) {
    console.error(
      `[parseModelJSON]${context ? ` (${context})` : ""} Failed to parse model output as JSON: ${
        error instanceof Error ? error.message : String(error)
      }\nRaw content: ${content}`,
    );
    return null;
  }
}
