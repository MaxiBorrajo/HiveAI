import type { Message } from "@/types/chat";

export async function sendMessage(content: string): Promise<Message> {
  const response = await fetch("http://localhost:8000/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: content }),
  });

  if (!response.ok) {
    throw new Error(`The backend responded with status ${response.status}`);
  }

  const data: { content: string; usedTools?: string[] } = await response.json();

  return {
    id: crypto.randomUUID(),
    role: "agent",
    content: data.content,
    timestamp: Date.now(),
    usedTools: data.usedTools,
  };
}
