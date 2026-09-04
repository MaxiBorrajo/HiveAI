import "dotenv/config";
import { HiveMicrokernel } from "./microkernel/hive-microkernel.ts";
import { humanInteractionQueue } from "./microkernel/human-interaction.ts";
import { HiveMind, type HiveAIState, type ChatStep } from "./ai/hive-queen.ts";
import {
  AIMessage,
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

const MODEL = "lfm2.5";

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

    // Generic human-interaction flow: any plugin can block waiting for one of
    // these to resolve its pending entry before it proceeds. The frontend
    // polls /interactions and renders UI based on each entry's payload.kind.
    if (url.pathname === "/interactions" && req.method === "GET") {
      return Response.json(humanInteractionQueue.list(), { headers });
    }

    const interactionMatch = url.pathname.match(
      /^\/interactions\/([^/]+)\/(approve|reject)$/,
    );
    if (interactionMatch && req.method === "POST") {
      const [, id, decision] = interactionMatch;
      const ok = humanInteractionQueue.resolve(decodeURIComponent(id), {
        kind: "approval",
        approved: decision === "approve",
      });
      return Response.json({ success: ok }, { headers, status: ok ? 200 : 404 });
    }

    return new Response(JSON.stringify("Bienvenido a HiveAI"), { headers });
  }),
);

hive.configure({
  dataDir: join(homeDir, ".hiveai", "storage"),
  model: MODEL,
});

let chatHistory: BaseMessage[] = [];

// Streams the final answer token-by-token via Server-Sent Events, instead of
// waiting for the whole graph run to finish. LangGraph's "messages" stream
// mode emits every token from every LLM-backed node (Selector included), so
// we filter to only forward tokens coming from the HiveQueen node — the
// Selector never produces user-facing text.
function handleChat(req: Request, headers: Record<string, string>): Response {
  const streamHeaders = {
    ...headers,
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  };

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        const body = await req.json();
        const userText = body.message;

        console.log(
          `/chat received. Active bees right now: [${hive
            .getRegisteredPlugins()
            .filter((p) => hive.isActive(p.name))
            .map((p) => p.name)
            .join(", ")}]`,
        );

        chatHistory.push(new HumanMessage(userText));

        // Selector/Executor can take a while before HiveQueen emits its first
        // token (tool selection + execution). Tell the frontend to show a
        // "thinking" indicator immediately; it clears it on the first token.
        send("thinking", {});

        let fullContent = "";
        const usedTools = new Set<string>();
        const steps: ChatStep[] = [];

        for await (const chunk of await HiveMind.stream(
          { messages: chatHistory, model: MODEL },
          { streamMode: ["messages", "values"] },
        )) {
          const [mode, payload] = chunk as
            | [
                "messages",
                [
                  {
                    content?: unknown;
                    additional_kwargs?: { reasoning_content?: string };
                  },
                  { langgraph_node?: string },
                ],
              ]
            | ["values", typeof HiveAIState.State];

          if (mode === "messages") {
            const [message, metadata] = payload;
            if (metadata.langgraph_node !== "HiveQueen") continue;

            const reasoningChunk = message.additional_kwargs?.reasoning_content;
            if (reasoningChunk) {
              send("thinking_delta", { content: reasoningChunk });
            }

            const chunkText = String(message.content ?? "");
            if (!chunkText) continue;
            fullContent += chunkText;
            send("token", { content: chunkText });
            continue;
          }

          // mode === "values": full state snapshot after each node — used to
          // pick up ToolMessages and the accumulated step log along the way.
          for (const message of payload.messages) {
            if (ToolMessage.isInstance(message) && message.name) {
              usedTools.add(message.name);
            }
          }
          steps.length = 0;
          steps.push(...payload.steps);
        }

        chatHistory.push(new AIMessage(fullContent));

        send("done", {
          content: fullContent,
          usedTools: Array.from(usedTools),
          steps,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        send("error", { message: detail });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: streamHeaders });
}
