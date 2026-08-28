import type { Message } from "@/types/chat";

// TODO: usar selectedPluginIds cuando HiveMind soporte selección de plugins.
export async function sendMessage(
  _content: string,
  _selectedPluginIds: string[],
): Promise<Message> {
  const response = await fetch("http://localhost:8001/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: _content,
    }),
  });

  if (!response.ok) {
    throw new Error(`El backend respondió con estado ${response.status}`);
  }

  const data: { content: string } = await response.json();

  return {
    id: crypto.randomUUID(),
    role: "agent",
    content: data.content,
  };
}
