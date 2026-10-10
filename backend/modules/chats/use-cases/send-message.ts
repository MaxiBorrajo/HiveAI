import { createSseResponse } from "../../../core/api/sse.ts";
import { ResponseBuilder } from "../../../core/api/response.ts";
import { type HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import {
  Scout,
  type ChatStep,
} from "../../../core/ai/strategy/scout/graph.ts";
import { ChatRepository } from "../../../infrastructure/db/repositories/chat-repository.ts";
import { MessageRepository } from "../../../infrastructure/db/repositories/message-repository.ts";
import { type ThinkingRun } from "../../../core/memory/types.ts";
import { resolveModelOptions } from "../../modes/lib/resolve-model-options.ts";
import type { AppDatabase } from "../../../infrastructure/db/orm.ts";
import { embedText } from "../../../core/memory/embeddings.ts";
import { splitContent } from "../../../core/ai/providers/capabilities.ts";
import { normalizeProviderError } from "../../../core/ai/providers/errors.ts";
import type { BeePlugin } from "../../../core/microkernel/bee-plugin.ts";

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
  wasStopped = false,
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
    metadata: JSON.stringify({
      usedTools,
      steps,
      thinkingRuns,
      ...(wasStopped ? { wasStopped } : {}),
    }),
    vector: JSON.stringify(vector),
  });
}

async function persistStoppedMessage(
  db: AppDatabase,
  chatId: number,
  { fullContent, steps, thinkingRuns }: StreamResult,
) {
  if (!fullContent) return;
  try {
    await persistAssistantMessage(
      db,
      chatId,
      fullContent,
      usedToolsOf(steps),
      steps,
      thinkingRuns,
      true,
    );
  } catch (error) {
    console.error("[Chat] Could not save the stopped response:", error);
  }
}

function usedToolsOf(steps: ChatStep[]): string[] {
  return Array.from(
    new Set(
      steps.filter((step) => step.node === "Executor").map((s) => s.label),
    ),
  );
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

export interface StreamResult {
  fullContent: string;
  steps: ChatStep[];
  thinkingRuns: ThinkingRun[];
}

export async function consumeStream(
  streamIterable: AsyncIterable<unknown>,
  finalNodeName: string,
  send: (event: string, data: unknown) => void,
  // Filled in place so the caller still has the partial result if the stream
  // is aborted (the promise rejects and returns nothing).
  progress: StreamResult = { fullContent: "", steps: [], thinkingRuns: [] },
): Promise<StreamResult> {
  const { steps, thinkingRuns } = progress;

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

      const { text: contentText, thinking: contentThinking } = splitContent(
        message.content,
      );
      const reasoningChunk =
        message.additional_kwargs?.reasoning_content || contentThinking;
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

      const chunkText = contentText;
      if (!chunkText) continue;
      progress.fullContent += chunkText;
      send("token", { content: chunkText });
      continue;
    }

    steps.length = 0;
    steps.push(...payload.steps);
  }

  return progress;
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
  return createSseResponse(headers, async (send) => {
    if (!userText.trim()) {
      send("error", { message: "The message cannot be empty." });
      return;
    }
    if (userText.length > MAX_MESSAGE_LENGTH) {
      send("error", {
        message: `The message is too long (${userText.length} characters, max ${MAX_MESSAGE_LENGTH}).`,
      });
      return;
    }

    const chatRepo = new ChatRepository(db);

    // Resolve or create chat
    let resolvedChatId: number;
    if (chatId !== null) {
      const existing = await chatRepo.findById(chatId);
      if (!existing) {
        send("error", { message: `Chat ${chatId} not found.` });
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

    const config = hive.getConfig();
    const modelProvider = config.get("modelProvider");
    const progress: StreamResult = {
      fullContent: "",
      steps: [],
      thinkingRuns: [],
    };
    let streamResult: StreamResult;
    try {
      const streamIterable = await Scout.stream(
        {
          messages: contextMessages,
          chatId: resolvedChatId.toString(),
          model,
          modelProvider,
          modelKeyId: config.get("modelKeyId"),
          modelOptions: modelProvider === "ollama" ? modelOptions : {},
        },
        { streamMode: ["messages", "values"], signal: req.signal },
      );
      streamResult = await consumeStream(
        streamIterable,
        "Agent",
        send,
        progress,
      );
    } catch (error) {
      if (req.signal.aborted) {
        await persistStoppedMessage(db, resolvedChatId, progress);
        throw error;
      }
      throw normalizeProviderError(error, modelProvider);
    }
    const { fullContent, steps, thinkingRuns } = streamResult;

    const usedTools = usedToolsOf(steps);

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
  });
}
