import type { Message } from "@/types/chat";

// TODO: reemplazar por una llamada real al backend (POST http://localhost:8000/chat)
export async function sendMessage(
  _history: Message[],
  content: string,
  selectedPluginIds: string[],
): Promise<Message> {
  await new Promise((resolve) => setTimeout(resolve, 600));

  const pluginsInfo =
    selectedPluginIds.length > 0
      ? `Plugins activos: ${selectedPluginIds.join(", ")}.`
      : "Sin plugins activos.";

  return {
    id: crypto.randomUUID(),
    role: "agent",
    content: `Recibí tu mensaje: "${content}". ${pluginsInfo} Todavía estoy mockeada, HiveQueen no está conectada de verdad.`,
  };
}
