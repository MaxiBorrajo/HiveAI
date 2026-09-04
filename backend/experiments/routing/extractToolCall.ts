function extractToolCall(response: AIMessage): { name: string; args: Record<string, unknown> } | null {
  // caso 1: Ollama parseó correctamente
  if (response.tool_calls?.length) {
    const call = response.tool_calls[0];
    return { name: call.name, args: call.args };
  }

  // caso 2: XML crudo en content
  const content = response.content as string;
  const nameMatch = content.match(/<function name="([^"]+)">/);
  if (!nameMatch) return null;

  const name = nameMatch[1];
  const args: Record<string, unknown> = {};
  const paramRegex = /<param name="([^"]+)">([\s\S]*?)<\/param>/g;
  let match;
  while ((match = paramRegex.exec(content)) !== null) {
    const value = match[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
    try {
      args[match[1]] = JSON.parse(value);
    } catch {
      args[match[1]] = value;
    }
  }

  return { name, args };
}