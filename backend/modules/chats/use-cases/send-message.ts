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
import { withUsageContext } from "../../../core/ai/usage/usage-context.ts";
import { loadChatUsage } from "../../usage/load-chat-usage.ts";
import { ModelUsageRepository } from "../../../infrastructure/db/repositories/model-usage-repository.ts";

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
  usageGroupId?: string,
): Promise<number> {
  const chatRepo = new ChatRepository(db);
  const msgRepo = new MessageRepository(db);

  const chat = await chatRepo.findById(chatId);
  if (!chat) throw new Error("Chat not found");

  chat.messageCount++;
  chat.updatedAt = Date.now();
  await chatRepo.update(chat);

  const vector = await embedText(fullContent);
  const messageId = await msgRepo.create({
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

  if (usageGroupId) await linkUsageToMessage(db, usageGroupId, messageId);
  return messageId;
}

// The calls were recorded before the message existed; link them by group.
async function linkUsageToMessage(
  db: AppDatabase,
  groupId: string,
  messageId: number,
): Promise<void> {
  try {
    await new ModelUsageRepository(db).attachMessage(groupId, messageId);
  } catch (error) {
    console.error("[Usage] Could not link the calls to the message:", error);
  }
}

async function persistStoppedMessage(
  db: AppDatabase,
  chatId: number,
  { fullContent, steps, thinkingRuns }: StreamResult,
  usageGroupId: string,
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
      usageGroupId,
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

// The response's consumption and the conversation totals, sent with `done` so
// the screen does not have to reload. Reading metrics must never cost the user
// the response they already got.
async function usageForDone(
  db: AppDatabase,
  chatId: number,
  messageId: number,
) {
  try {
    const { byMessage, conversation } = await loadChatUsage(db, chatId);
    return {
      usage: byMessage.get(messageId) ?? null,
      conversationUsage: conversation,
    };
  } catch (error) {
    console.error("[Usage] Could not read the response usage:", error);
    return {};
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
    const usageGroupId = crypto.randomUUID();
    let streamResult: StreamResult;
    try {
      streamResult = await withUsageContext(
        {
          kind: "chat",
          role: "orchestrator",
          chatId: resolvedChatId,
          groupId: usageGroupId,
        },
        async () => {
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
          return await consumeStream(streamIterable, "Agent", send, progress);
        },
      );
    } catch (error) {
      if (req.signal.aborted) {
        await persistStoppedMessage(db, resolvedChatId, progress, usageGroupId);
        throw error;
      }
      throw normalizeProviderError(error, modelProvider);
    }
    const { fullContent, steps, thinkingRuns } = streamResult;

    const usedTools = usedToolsOf(steps);

    const messageId = await persistAssistantMessage(
      db,
      resolvedChatId,
      fullContent,
      usedTools,
      steps,
      thinkingRuns,
      false,
      usageGroupId,
    );

    send("done", {
      content: fullContent,
      usedTools,
      steps,
      thinkingRuns,
      ...(await usageForDone(db, resolvedChatId, messageId)),
    });
  });
}
