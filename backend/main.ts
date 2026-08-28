import { HiveMicrokernel } from "./microkernel/hive-microkernel.ts";
import { HiveMind } from "./ai/hive-queen.ts";
import { HumanMessage, BaseMessage } from "@langchain/core/messages";
import { join } from "node:path";
import { ChatOllama } from "@langchain/ollama";
// 1. Configuramos el Backend
const hive = HiveMicrokernel.getInstance();
const homeDir = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE")!;

const MODEL = "qwen3:8b";

async function main() {
  await hive.loadAndRegister(
    "/home/maxi/Documents/HiveAI/backend/plugins/counter",
  );
  await hive.loadAndRegister(
    "/home/maxi/Documents/HiveAI/backend/plugins/current-datetime",
  );

  console.log(hive.getRegisteredPlugins().map((p) => p.name));
}

main().then(() =>
  Deno.serve({ port: 8001 }, (req: Request) => {
    console.log(req);
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
  }),
);

hive.configure({
  dataDir: join(homeDir, ".hiveai", "storage"),
  model: MODEL,
});

let chatHistory: BaseMessage[] = [];

async function handleChat(
  req: Request,
  headers: Record<string, string>,
): Promise<Response> {
  const body = await req.json();

  const userText = body.message;

  chatHistory.push(new HumanMessage(userText));

  const result = await HiveMind.invoke({
    messages: chatHistory,
    model: MODEL,
  });

  console.log(result.messages);

  chatHistory = result.messages;

  const lastMessage = chatHistory[chatHistory.length - 1];

  return Response.json({ content: lastMessage.content }, { headers });
}

export async function warmUp(model: string): Promise<void> {
  try {
    const start = performance.now();
    await new ChatOllama({ model, think: false, keepAlive: "10m" }).invoke([
      new HumanMessage("ok"),
    ]);
    console.log(`Modelo listo en ${Math.round(performance.now() - start)}ms`);
  } catch (error) {
    console.warn("No se pudo precargar el modelo:", error);
  }
}
