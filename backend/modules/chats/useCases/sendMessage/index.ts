import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import type { BeePlugin } from "../../../../core/microkernel/bee-plugin.ts";
import {
  HiveMind,
  HiveAIState,
  type ChatStep,
} from "../../../../core/ai/strategy/SADER/graph.ts";
import { resolveModelOptions } from "../../../modes/utils/resolveModelOptions.ts";
import { createChat, getChat, touchChat } from "../../../../core/memory/chatStore.ts";
import { addMessage } from "../../../../core/memory/messageStore.ts";
import { embedText, ensureEmbeddingModelReady } from "../../../../core/memory/embeddings.ts";
import { buildTurnContext } from "../../../../core/memory/contextBuilder.ts";

function deriveTitle(message: string): string {
  const trimmed = message.trim();
  return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
}

function persistUserMessageInBackground(
  dataDir: string,
  chatId: string,
  userText: string,
): void {
  embedText(userText)
    .then((vector) => addMessage(dataDir, chatId, "user", userText, vector))
    .then(() => touchChat(dataDir, chatId))
    .catch((error) => {
      console.error("Failed to persist user message:", error);
    });
}

function persistAgentMessageInBackground(
  dataDir: string,
  chatId: string,
  fullContent: string,
  usedTools: string[],
  steps: ChatStep[],
): void {
  embedText(fullContent)
    .then((vector) =>
      addMessage(dataDir, chatId, "agent", fullContent, vector, {
        usedTools,
        steps,
      }),
    )
    .then(() => touchChat(dataDir, chatId))
    .catch((error) => {
      console.error("Failed to persist agent message:", error);
    });
}

export function handleChat(
  hive: HiveMicrokernel,
  model: string,
  selectorModel: string,
  req: Request,
  headers: Record<string, string>,
): Response {
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
        const userText: string = body.message;
        const dataDir = hive.getConfig().get("dataDir");

        await ensureEmbeddingModelReady();

        let chatId: string = body.chatId;
        if (!chatId) {
          const chat = await createChat(dataDir, deriveTitle(userText));
          chatId = chat.id;
          send("chat_created", { chatId });
        } else {
          const existingChat = await getChat(dataDir, chatId);
          if (!existingChat) {
            send("error", { message: `Chat '${chatId}' was not found.` });
            return;
          }
        }

        console.log(
          `/chat received. Active bees right now: [${hive
            .getRegisteredPlugins()
            .filter((p: BeePlugin) => hive.isActive(p.name))
            .map((p: BeePlugin) => p.name)
            .join(", ")}]`,
        );

        persistUserMessageInBackground(dataDir, chatId, userText);

        send("thinking", {});

        const modelOptions = await resolveModelOptions(
          hive.getConfig().get("currentMode"),
        );

        const contextMessages = await buildTurnContext(dataDir, chatId, userText);

        let fullContent = "";
        const steps: ChatStep[] = [];

        for await (const chunk of await HiveMind.stream(
          {
            messages: contextMessages,
            chatId,
            model,
            selectorModel,
            currentPrompt: userText,
            modelOptions,
          },
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

            const reasoningChunk = message.additional_kwargs?.reasoning_content;
            if (reasoningChunk) {
              send("thinking_delta", { content: reasoningChunk });
            }

            if (metadata.langgraph_node !== "HiveQueenResponder") continue;

            const chunkText = String(message.content ?? "");
            if (!chunkText) continue;
            fullContent += chunkText;
            send("token", { content: chunkText });
            continue;
          }

          steps.length = 0;
          steps.push(...payload.steps);
        }

        const usedTools = Array.from(
          new Set(
            steps
              .filter((step) => step.node === "Executor")
              .map((step) => step.label),
          ),
        );

        persistAgentMessageInBackground(dataDir, chatId, fullContent, usedTools, steps);

        send("done", { content: fullContent, usedTools, steps });
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
