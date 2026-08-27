import { HiveMicrokernel } from "./microkernel/hive-microkernel.ts";
import { HiveMind } from "./ai/hive-queen.ts";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { join } from "node:path";

// 1. Configuramos el Backend
const hive = HiveMicrokernel.getInstance();
const homeDir = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE")!;

const MODEL = "qwen3:8b";

hive.configure({
  dataDir: join(homeDir, ".hiveai"),
  model: MODEL,
});

Deno.serve((req: Request) => {
  const url = new URL(req.url);
  const headers = {
    "content-type": "application/json",
    "Access-Control-Allow-Origin": "*", // Para permitir peticiones de Vite en desarrollo
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  if (url.pathname === "/plugins") {
    return Response.json(hive.getRegisteredPlugins(), { headers });
  }

  if (url.pathname === "/chat" && req.method === "POST") {
    return handleChat(req, headers);
  }

  return new Response(JSON.stringify("Bienvenido a HiveAI"), { headers });
});

async function handleChat(
  req: Request,
  headers: Record<string, string>,
): Promise<Response> {
  const { messages } = await req.json() as {
    messages: { role: "user" | "agent"; content: string }[];
  };

  const langchainMessages = messages.map((m) =>
    m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content)
  );

  const result = await HiveMind.invoke({
    messages: langchainMessages,
    model: MODEL,
  });

  const lastMessage = result.messages[result.messages.length - 1];

  return Response.json(
    { content: lastMessage.content },
    { headers },
  );
}
