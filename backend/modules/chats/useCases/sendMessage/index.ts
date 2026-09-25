import { ResponseBuilder } from "../../../../core/api/response.ts";
import { type HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import {
  Scout,
  type ChatStep,
} from "../../../../core/ai/strategy/SCOUT/graph.ts";
import { ChatRepository } from "../../../../infrastructure/db/repositories/ChatRepository.ts";
import { MessageRepository } from "../../../../infrastructure/db/repositories/MessageRepository.ts";
import { type ThinkingRun } from "../../../../core/memory/types.ts";
import { resolveModelOptions } from "../../../modes/utils/resolve-model-options.ts";
import type { AppDatabase } from "../../../../infrastructure/db/orm.ts";
import { embedText } from "../../../../core/memory/embeddings.ts";
import type { BeePlugin } from "../../../../core/microkernel/bee-plugin.ts";

const MAX_MESSAGE_LENGTH = 20_000;

async function persistUserMessage(
  db: AppDatabase,
  chatId: number,
  userText: string,
) {
  const chatRepo = new ChatRepository(db);
  const msgRepo = new MessageRepository(db);

  const chat = await chatRepo.findById(chatId);
  if (!chat) throw new Error("Chat not found");

  chat.messageCount++;
  chat.updatedAt = Date.now();
  await chatRepo.update(chat);

  const vector = await embedText(userText);
  await msgRepo.create({
    chatId: chat.id,
    role: "user",
    content: userText,
    timestamp: Date.now(),
    metadata: null,
    vector: JSON.stringify(vector),
  });
}

async function persistAssistantMessage(
  db: AppDatabase,
  chatId: number,
  fullContent: string,
  usedTools: string[],
  steps: ChatStep[],
  thinkingRuns: ThinkingRun[],
) {
  const chatRepo = new ChatRepository(db);
  const msgRepo = new MessageRepository(db);

  const chat = await chatRepo.findById(chatId);
  if (!chat) throw new Error("Chat not found");

  chat.messageCount++;
  chat.updatedAt = Date.now();
  await chatRepo.update(chat);

  const vector = await embedText(fullContent);
  await msgRepo.create({
    chatId: chat.id,
    role: "agent",
    content: fullContent,
    timestamp: Date.now(),
    metadata: JSON.stringify({ usedTools, steps, thinkingRuns }),
    vector: JSON.stringify(vector),
  });
}

export function appendThinkingDelta(
  runs: ThinkingRun[],
  content: string,
  node: string | undefined,
): void {
  const last = runs[runs.length - 1];
  if (last && last.node === node) {
    last.text += content;
  } else {
    runs.push({ node, text: content });
  }
}

export async function consumeStream(
  streamIterable: AsyncIterable<unknown>,
  finalNodeName: string,
  send: (event: string, data: unknown) => void,
): Promise<{
  fullContent: string;
  steps: ChatStep[];
  thinkingRuns: ThinkingRun[];
}> {
  let fullContent = "";
  const steps: ChatStep[] = [];
  const thinkingRuns: ThinkingRun[] = [];

  for await (const chunk of streamIterable) {
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
      | ["values", { steps: ChatStep[] }];

    if (mode === "messages") {
      const [message, metadata] = payload;

      const reasoningChunk = message.additional_kwargs?.reasoning_content;
      if (reasoningChunk) {
        appendThinkingDelta(
          thinkingRuns,
          reasoningChunk,
          metadata.langgraph_node,
        );
        send("thinking_delta", {
          content: reasoningChunk,
          node: metadata.langgraph_node,
        });
      }

      if (metadata.langgraph_node !== finalNodeName) continue;

      const chunkText = String(message.content ?? "");
      if (!chunkText) continue;
      fullContent += chunkText;
      send("token", { content: chunkText });
      continue;
    }

    steps.length = 0;
    steps.push(...payload.steps);
  }

  return { fullContent, steps, thinkingRuns };
}

export async function sendMessage(
  db: AppDatabase,
  chatId: number | null,
  userText: string,
  hive: HiveMicrokernel,
  model: string,
  req: Request,
  headers: Record<string, string>,
): Promise<Response> {
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
        const chatRepo = new ChatRepository(db);

        // Resolve or create chat
        let resolvedChatId: number;
        if (chatId !== null) {
          const existing = await chatRepo.findById(chatId);
          if (!existing) {
            send("error", { message: `Chat ${chatId} not found.` });
            controller.close();
            return;
          }
          resolvedChatId = chatId;
        } else {
          const generatedTitle =
            userText.length > 50 ? userText.slice(0, 47) + "..." : userText;
          resolvedChatId = await chatRepo.create({
            title: generatedTitle,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messageCount: 0,
          });
          send("chat_created", { chatId: resolvedChatId.toString() });
        }

        if (userText.length > MAX_MESSAGE_LENGTH) {
          send("error", {
            message: `The message is too long (${userText.length} characters, max ${MAX_MESSAGE_LENGTH}).`,
          });
          return;
        }

        console.log(
          `/chat received. Active bees right now: [${hive
            .getRegisteredPlugins()
            .filter((p: BeePlugin) => hive.isActive(p.name))
            .map((p: BeePlugin) => p.name)
            .join(", ")}]`,
        );

        await persistUserMessage(db, resolvedChatId, userText);

        send("thinking", {});

        const modelOptions = await resolveModelOptions(
          hive.getConfig().get("currentMode"),
        );

        const msgRepo = new MessageRepository(db);
        const contextMessages = await msgRepo.buildTurnContext(
          resolvedChatId,
          userText,
        );

        const streamIterable = await Scout.stream(
          { messages: contextMessages, chatId: resolvedChatId.toString(), model, modelOptions },
          { streamMode: ["messages", "values"], signal: req.signal },
        );

        const { fullContent, steps, thinkingRuns } = await consumeStream(
          streamIterable,
          "Agent",
          send,
        );

        const usedTools = Array.from(
          new Set(
            steps
              .filter((step) => step.node === "Executor")
              .map((step) => step.label),
          ),
        );

        await persistAssistantMessage(
          db,
          resolvedChatId,
          fullContent,
          usedTools,
          steps,
          thinkingRuns,
        );

        send("done", {
          content: fullContent,
          usedTools,
          steps,
          thinkingRuns,
        });
        controller.close();
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
