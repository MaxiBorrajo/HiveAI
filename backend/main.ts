import { HiveMicrokernel } from "./microkernel/hive-microkernel.ts";
import { HiveMind } from "./ai/hive-queen.ts";
import {
  HumanMessage,
  type BaseMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// 1. Configuramos el Backend
const hive = HiveMicrokernel.getInstance();
const homeDir = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE")!;
const __dirname = dirname(fileURLToPath(import.meta.url));

const MODEL = "qwen3:8b";

async function main() {
  const pluginsDir = join(__dirname, "plugins");

  for await (const entry of Deno.readDir(pluginsDir)) {
    if (entry.isDirectory) {
      await hive.loadAndRegister(join(pluginsDir, entry.name));
    }
  }

  console.log(hive.getRegisteredPlugins().map((p) => p.name));
}

main().then(() =>
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
      const plugins = hive.getRegisteredPlugins().map((plugin) => ({
        name: plugin.name,
        description: plugin.description,
        active: hive.isActive(plugin.name),
      }));
      return Response.json(plugins, { headers });
    }

    const activateMatch = url.pathname.match(/^\/plugins\/([^/]+)\/activate$/);
    if (activateMatch && req.method === "POST") {
      const ok = hive.activate(decodeURIComponent(activateMatch[1]));
      return Response.json({ success: ok }, { headers, status: ok ? 200 : 404 });
    }

    const deactivateMatch = url.pathname.match(
      /^\/plugins\/([^/]+)\/deactivate$/,
    );
    if (deactivateMatch && req.method === "POST") {
      const ok = hive.deactivate(decodeURIComponent(deactivateMatch[1]));
      return Response.json({ success: ok }, { headers, status: ok ? 200 : 404 });
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

  console.log(
    `/chat received. Active bees right now: [${hive
      .getRegisteredPlugins()
      .filter((p) => hive.isActive(p.name))
      .map((p) => p.name)
      .join(", ")}]`,
  );

  // Agregamos solo el mensaje nuevo al historial que vive en memoria
  const turnStart = chatHistory.length;
  chatHistory.push(new HumanMessage(userText));

  const result = await HiveMind.invoke({
    messages: chatHistory,
    model: MODEL,
  });

  console.log(result.messages.slice(-1, -4));

  chatHistory = result.messages;

  // Herramientas usadas durante este turno (a partir del mensaje del usuario)
  const usedTools = Array.from(
    new Set(
      chatHistory
        .slice(turnStart)
        .filter((message): message is ToolMessage =>
          ToolMessage.isInstance(message),
        )
        .map((message) => message.name)
        .filter((name): name is string => Boolean(name)),
    ),
  );

  const lastMessage = chatHistory[chatHistory.length - 1];

  return Response.json(
    { content: lastMessage.content, usedTools },
    { headers },
  );
}
