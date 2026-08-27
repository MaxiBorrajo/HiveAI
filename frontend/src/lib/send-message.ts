import type { Message } from "@/types/chat";

// TODO: usar selectedPluginIds cuando HiveMind soporte selección de plugins.
export async function sendMessage(
  history: Message[],
  _content: string,
  _selectedPluginIds: string[],
): Promise<Message> {
  const response = await fetch("http://localhost:8000/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: history.map((m) => ({ role: m.role, content: m.content })),
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
