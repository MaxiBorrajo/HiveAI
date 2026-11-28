import { createSseResponse } from "../../../core/api/sse.ts";
import { ResponseBuilder } from "../../../core/api/response.ts";
import { type HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import { SCOUT_RECURSION_LIMIT } from "../../../core/ai/strategy/scout/constants.ts";
import {
  Scout,
  type ChatStep,
} from "../../../core/ai/strategy/scout/graph.ts";
import { ChatRepository } from "../../../infrastructure/db/repositories/chat-repository.ts";
import { MessageRepository } from "../../../infrastructure/db/repositories/message-repository.ts";
import { type ThinkingRun } from "../../../core/memory/types.ts";
import { executionContextStorage } from "../../../core/microkernel/human-interaction.ts";
import { beginModelActivity } from "../../../core/ai/activity-tracker.ts";
import { watchModelLoad } from "../../../core/ollama/model-load.ts";
import { resolveModelOptions } from "../../model-settings/lib/resolve-model-options.ts";
import {
  ALWAYS_THINKING_NOTICE,
  rememberAlwaysThinking,
} from "../../model-settings/lib/always-thinking-store.ts";
import type { AppDatabase } from "../../../infrastructure/db/orm.ts";
import { embedText } from "../../../core/memory/embeddings.ts";
import { splitContent } from "../../../core/ai/providers/capabilities.ts";
import { InlineThinkingSplitter } from "../../../core/ai/providers/inline-thinking.ts";
import {
  REPETITION_LOOP_WARNING,
  RepetitionWatcher,
} from "../../../core/ai/providers/repetition-loop.ts";
import { normalizeProviderError } from "../../../core/ai/providers/errors.ts";
import type { BeePlugin } from "../../../core/microkernel/bee-plugin.ts";
import { withUsageContext } from "../../../core/ai/usage/usage-context.ts";
import { loadChatUsage } from "../../usage/load-chat-usage.ts";
import { ModelUsageRepository } from "../../../infrastructure/db/repositories/model-usage-repository.ts";
import { AttachmentRepository } from "../../../infrastructure/db/repositories/attachment-repository.ts";
import {
  buildAttachmentContent,
  type AttachmentContentPart,
} from "../../../core/attachments/build-attachment-content.ts";
import { toHumanContent } from "../../../core/attachments/to-human-content.ts";
import {
  generatedFilesStorage,
  type GeneratedFilesContext,
} from "../../../core/attachments/generated-files.ts";
import { toAttachmentDto, type AttachmentDto } from "../../attachments/types.ts";
import type { Attachment } from "../../../infrastructure/db/repositories/attachment-repository.ts";
import { scheduleAttachmentIndexing } from "../../../core/attachments/attachment-index.ts";
import { duplicateAttachment } from "../../../core/attachments/duplicate-attachment.ts";
import { ensureScansRead } from "../../../core/attachments/scan-recognition.ts";
import {
  retrieveAttachmentExcerpts,
  type Retrieval,
} from "../../../core/attachments/attachment-retrieval.ts";
import { boundHistoryForCloud } from "../../../core/ai/token-savings/bounded-history.ts";
import { withCompactionListener } from "../../../core/ai/token-savings/notice.ts";
import {
  isCloudProvider,
  normalizeModelRef,
  type ModelRef,
} from "../../../core/ai/providers/types.ts";
import {
  attachmentBudget,
  OLLAMA_DEFAULT_NUM_CTX,
} from "../../../core/attachments/context-budget.ts";
import { HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { type ModelSuggestion, suggestModelsForTurn } from "./suggest-models.ts";

const MAX_MESSAGE_LENGTH = 100_000;

export interface SendMessageOptions {
  /** Answer with this model instead of the one configured for the app. */
  modelRef?: ModelRef;
  /** Context prepended to every turn without being stored in the chat. */
  preamble?: string;
  /** Title for a chat created by this message. */
  title?: string;
  /** Ties a created chat to a run comparison so it is kept out of the chat list. */
  runComparison?: { executionId: number; historyIds: number[] };
}

async function persistUserMessage(
  db: AppDatabase,
  dataDir: string,
  chatId: number,
  userText: string,
  attachmentIds: number[],
): Promise<number> {
  const chatRepo = new ChatRepository(db);
  const msgRepo = new MessageRepository(db);

  const chat = await chatRepo.findById(chatId);
  if (!chat) throw new Error("Chat not found");

  chat.messageCount++;
  chat.updatedAt = Date.now();
  await chatRepo.update(chat);

  const vector = await embedText(userText);
  const messageId = await msgRepo.create({
    chatId: chat.id,
    role: "user",
    content: userText,
    timestamp: Date.now(),
    metadata: null,
    vector: JSON.stringify(vector),
  });

  if (attachmentIds.length > 0) {
    const attachmentRepo = new AttachmentRepository(db);
    for (const id of attachmentIds) {
      const attachment = await attachmentRepo.findById(id);
      // A file reused from an earlier message stays with that message too.
      if (attachment?.messageId != null) {
        await duplicateAttachment(dataDir, attachmentRepo, attachment, {
          chatId: chat.id,
          messageId,
        });
      } else {
        await attachmentRepo.linkToMessage(id, messageId, chat.id);
      }
    }
  }

  return messageId;
}

/** Never fails the turn: without search the model just answers from the chat. */
async function searchChatFiles(
  db: AppDatabase,
  dataDir: string,
  chatId: number,
  query: string,
  sentChars: Map<number, number>,
  maxChars: number,
): Promise<Retrieval> {
  try {
    const repo = new AttachmentRepository(db);
    // Files from before search existed, or whose indexing a restart cut short.
    const unindexed = await repo.findUnindexedChatIds(chatId);
    for (const id of unindexed) scheduleAttachmentIndexing(dataDir, repo, id);
    await ensureScansRead(dataDir, repo, unindexed);
    return await retrieveAttachmentExcerpts({
      repo,
      chatId,
      query,
      embed: embedText,
      maxChars,
      sentChars,
    });
  } catch (error) {
    console.error("[Attachments] Could not search the chat's files:", error);
    return { warnings: [] };
  }
}

/** Files the model created belong to its reply, and can be searched later. */
async function attachGeneratedFiles(
  db: AppDatabase,
  dataDir: string,
  chatId: number,
  messageId: number,
  files: Attachment[],
): Promise<AttachmentDto[]> {
  const repo = new AttachmentRepository(db);
  for (const file of files) {
    await repo.linkToMessage(file.id, messageId, chatId);
    scheduleAttachmentIndexing(dataDir, repo, file.id);
  }
  return files.map((file) => toAttachmentDto({ ...file, messageId, chatId }));
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
  modelSuggestion?: ModelSuggestion | null,
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
      // kept in metadata, never in `content`: it must not reach the embedding or the model's history
      ...(modelSuggestion ? { modelSuggestion } : {}),
    }),
    vector: JSON.stringify(vector),
  });

  if (usageGroupId) await linkUsageToMessage(db, usageGroupId, messageId);
  return messageId;
}

/** Thinking was off and the model reasoned all the same: record it, and say so the first time. */
async function noteIfReasonedAnyway(
  model: string,
  thinkingRuns: ThinkingRun[],
  send: (event: string, data: unknown) => void,
): Promise<void> {
  if (!thinkingRuns.some((run) => run.text.trim())) return;
  try {
    if (await rememberAlwaysThinking(model)) {
      send("warning", { message: ALWAYS_THINKING_NOTICE });
      send("always_thinking", { model });
    }
  } catch (error) {
    console.error("[Chat] Could not record that the model always thinks:", error);
  }
}

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
): Promise<number | undefined> {
  if (!fullContent) return;
  try {
    return await persistAssistantMessage(
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
  /** The model fell into a loop and was stopped; the text is cut where it began. */
  repetitionLoop?: boolean;
}

export async function consumeStream(
  streamIterable: AsyncIterable<unknown>,
  finalNodeName: string,
  send: (event: string, data: unknown) => void,
  progress: StreamResult = { fullContent: "", steps: [], thinkingRuns: [] },
  /** Stops the model; called when it falls into a loop. */
  stop: () => void = () => {},
): Promise<StreamResult> {
  const { steps, thinkingRuns } = progress;
  let seenMessages = 0;
  const splitters = new Map<string | undefined, InlineThinkingSplitter>();
  const splitterFor = (node: string | undefined) => {
    let splitter = splitters.get(node);
    if (!splitter) splitters.set(node, splitter = new InlineThinkingSplitter());
    return splitter;
  };
  const textWatcher = new RepetitionWatcher();
  const thinkingWatchers = new WeakMap<ThinkingRun, RepetitionWatcher>();
  const loopedAt = (run: ThinkingRun) => {
    let watcher = thinkingWatchers.get(run);
    if (!watcher) thinkingWatchers.set(run, watcher = new RepetitionWatcher());
    return watcher.check(run.text);
  };
  const stopForLoop = () => {
    progress.repetitionLoop = true;
    stop();
  };

  try {
    for await (const chunk of streamIterable) {
      // Stopped: drain what is still in flight until the abort ends the stream.
      if (progress.repetitionLoop) continue;
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
        | ["values", { steps: ChatStep[]; messages?: unknown[] }];

      if (mode === "messages") {
        const [message, metadata] = payload;

        const { text: contentText, thinking: contentThinking } = splitContent(
          message.content,
        );
        // Thinking written inline as <think>…</think> (see inline-thinking.ts).
        const inline = splitterFor(metadata.langgraph_node).push(contentText);
        const reasoningChunk =
          (message.additional_kwargs?.reasoning_content || contentThinking) +
          inline.thinking;
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
          const run = thinkingRuns[thinkingRuns.length - 1];
          const cut = loopedAt(run);
          if (cut !== null) {
            run.text = run.text.slice(0, cut);
            stopForLoop();
            continue;
          }
        }

        if (metadata.langgraph_node !== finalNodeName) continue;

        const chunkText = inline.text;
        if (!chunkText) continue;
        progress.fullContent += chunkText;
        send("token", { content: chunkText });
        const cut = textWatcher.check(progress.fullContent);
        if (cut !== null) {
          progress.fullContent = progress.fullContent.slice(0, cut);
          stopForLoop();
        }
        continue;
      }

      const alreadySent = steps.length;
      steps.length = 0;
      steps.push(...payload.steps);
      for (const step of payload.steps.slice(alreadySent)) send("step", step);

      const messages = payload.messages ?? [];
      if (messages.length > seenMessages) {
        seenMessages = messages.length;
        const last = messages[messages.length - 1] as {
          tool_calls?: { name: string; args: Record<string, unknown> }[];
        };
        if (last?.tool_calls?.length) {
          send("tool_calls", {
            calls: last.tool_calls.map(({ name, args }) => ({ name, args })),
          });
        }
      }
    }
  } catch (error) {
    // The abort that stopped the loop, not a failure.
    if (progress.repetitionLoop) return progress;
    throw error;
  }

  if (!progress.repetitionLoop) {
    // Text held back in case it was the start of a tag.
    const rest = splitterFor(finalNodeName).flush().text;
    if (rest) {
      progress.fullContent += rest;
      send("token", { content: rest });
    }
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
  attachmentIds: number[] = [],
  options: SendMessageOptions = {},
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

    // Resolve attachments before anything is persisted, so a rejected file
    // leaves no chat or message behind and the client can restore the input.
    const modelOptions = await resolveModelOptions();
    const budget = attachmentBudget(
      isCloudProvider(options.modelRef?.provider ?? hive.getConfig().get("modelProvider"))
        ? undefined
        : modelOptions.numCtx ?? OLLAMA_DEFAULT_NUM_CTX,
    );
    let attachmentParts: AttachmentContentPart[] = [];
    let sentChars = new Map<number, number>();
    if (attachmentIds.length > 0) {
      const config = hive.getConfig();
      const modelRef = options.modelRef ?? normalizeModelRef(model, {
        provider: config.get("modelProvider"),
        keyId: config.get("modelKeyId"),
      });
      try {
        const content = await buildAttachmentContent(
          config.get("dataDir"),
          new AttachmentRepository(db),
          attachmentIds,
          modelRef,
          budget.attachmentChars,
        );
        attachmentParts = content.parts;
        sentChars = content.sentChars;
        for (const message of content.warnings) send("warning", { message });
      } catch (error) {
        send("error", {
          message:
            error instanceof Error ? error.message : "Could not read an attachment.",
          rejected: true,
        });
        return;
      }
    }

    const chatRepo = new ChatRepository(db);

    let resolvedChatId: number;
    if (chatId !== null) {
      const existing = await chatRepo.findById(chatId);
      if (!existing) {
        send("error", { message: `Chat ${chatId} not found.` });
        return;
      }
      resolvedChatId = chatId;
    } else {
      const generatedTitle = options.title ??
        (userText.length > 50 ? userText.slice(0, 47) + "..." : userText);
      resolvedChatId = await chatRepo.create({
        title: generatedTitle,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 0,
        executionId: options.runComparison?.executionId ?? null,
      }, options.runComparison?.historyIds ?? []);
      send("chat_created", { chatId: resolvedChatId.toString() });
    }

    console.log(
      `/chat received. Active bees right now: [${hive
        .getRegisteredPlugins()
        .filter((p: BeePlugin) => hive.isActive(p.name))
        .map((p: BeePlugin) => p.name)
        .join(", ")}]`,
    );

    const userMessageId = await persistUserMessage(
      db,
      hive.getConfig().get("dataDir"),
      resolvedChatId,
      userText,
      attachmentIds,
    );
    // The client shows the message under a temporary id until it gets this one;
    // forking from it needs the stored id.
    send("user_message", { messageId: userMessageId.toString() });

    send("thinking", {});

    const excerpts = await searchChatFiles(
      db,
      hive.getConfig().get("dataDir"),
      resolvedChatId,
      userText,
      sentChars,
      budget.excerptChars,
    );
    for (const message of excerpts.warnings) send("warning", { message });
    if (excerpts.text) {
      attachmentParts.push({ type: "text", text: excerpts.text });
    }

    const msgRepo = new MessageRepository(db);
    let contextMessages = await msgRepo.buildTurnContext(
      resolvedChatId,
      userText,
    );

    if (attachmentParts.length > 0) {
      const lastIndex = contextMessages.length - 1;
      const last = contextMessages[lastIndex];
      if (last instanceof HumanMessage) {
        contextMessages[lastIndex] = new HumanMessage({
          content: toHumanContent(
            userText,
            attachmentParts,
          ) as unknown as BaseMessage["content"],
        });
      }
    }

    if (options.preamble) {
      contextMessages.unshift(new SystemMessage(options.preamble));
    }

    const config = hive.getConfig();
    const modelProvider = options.modelRef?.provider ?? config.get("modelProvider");
    const modelKeyId = options.modelRef
      ? (options.modelRef.keyId ?? "")
      : config.get("modelKeyId");
    if (options.modelRef) model = options.modelRef.model;
    contextMessages = boundHistoryForCloud(contextMessages, modelProvider);
    const progress: StreamResult = {
      fullContent: "",
      steps: [],
      thinkingRuns: [],
    };
    const usageGroupId = crypto.randomUUID();
    const generatedFiles: GeneratedFilesContext = {
      dataDir: config.get("dataDir"),
      repo: new AttachmentRepository(db),
      chatId: resolvedChatId,
      files: [],
      onFailure: (message) => send("warning", { message }),
    };
    let streamResult: StreamResult;
    const loopStop = new AbortController();
    const endModelActivity = modelProvider === "ollama"
      ? beginModelActivity(model)
      : () => {};
    const stopWatchingModelLoad =
      modelProvider === "ollama"
        ? await watchModelLoad(model, (phase) => send("status", { phase }))
        : () => {};
    try {
      streamResult = await generatedFilesStorage.run(generatedFiles, () => withUsageContext(
        {
          kind: "chat",
          role: "orchestrator",
          chatId: resolvedChatId,
          groupId: usageGroupId,
        },
        async () => {
          return await executionContextStorage.run(
            { autoApprove: false, signal: req.signal },
            async () => {
              return await withCompactionListener(
                () => send("status", { phase: "compacting" }),
                async () => {
              const streamIterable = await Scout.stream(
                {
                  messages: contextMessages,
                  chatId: resolvedChatId.toString(),
                  model,
                  modelProvider,
                  modelKeyId,
                  modelOptions: modelProvider === "ollama" ? modelOptions : {},
                },
                {
                  streamMode: ["messages", "values"],
                  recursionLimit: SCOUT_RECURSION_LIMIT,
                  signal: AbortSignal.any([req.signal, loopStop.signal]),
                },
              );
              return await consumeStream(
                streamIterable,
                "Agent",
                send,
                progress,
                () => loopStop.abort(),
              );
                },
              );
            },
          );
        },
      ));
    } catch (error) {
      if (req.signal.aborted) {
        const stoppedId = await persistStoppedMessage(db, resolvedChatId, progress, usageGroupId);
        if (stoppedId !== undefined) {
          await attachGeneratedFiles(db, config.get("dataDir"), resolvedChatId, stoppedId, generatedFiles.files);
        }
        throw error;
      }
      throw normalizeProviderError(error, modelProvider);
    } finally {
      stopWatchingModelLoad();
      endModelActivity();
    }
    const { fullContent, steps, thinkingRuns } = streamResult;
    if (streamResult.repetitionLoop) send("warning", { message: REPETITION_LOOP_WARNING });
    if (modelProvider === "ollama" && modelOptions.think === false) {
      await noteIfReasonedAnyway(model, thinkingRuns, send);
    }

    const usedTools = usedToolsOf(steps);

    // "Try these models" note for the end of the answer. Its small-model call
    // (if any) is billed to this turn's usage group.
    const modelSuggestion = await withUsageContext(
      { kind: "chat", role: "delegate", chatId: resolvedChatId, groupId: usageGroupId },
      () =>
        suggestModelsForTurn({
          text: userText,
          hasImage: attachmentParts.some((p) => p.type === "image"),
          hasDocument: attachmentParts.some((p) => p.type === "text"),
          currentRef: { provider: modelProvider, model, keyId: modelKeyId },
          hive,
        }),
    );
    if (modelSuggestion) send("model_suggestion", modelSuggestion);

    const messageId = await persistAssistantMessage(
      db,
      resolvedChatId,
      fullContent,
      usedTools,
      steps,
      thinkingRuns,
      false,
      usageGroupId,
      modelSuggestion,
    );
    const files = await attachGeneratedFiles(
      db,
      config.get("dataDir"),
      resolvedChatId,
      messageId,
      generatedFiles.files,
    );

    send("done", {
      messageId: messageId.toString(),
      content: fullContent,
      usedTools,
      steps,
      thinkingRuns,
      files,
      ...(await usageForDone(db, resolvedChatId, messageId)),
    });
  });
}
