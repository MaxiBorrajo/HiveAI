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
import { embedText } from "../../../../core/memory/embeddings.ts";
import { buildTurnContext } from "../../../../core/memory/contextBuilder.ts";
import type { ThinkingRun } from "../../../../core/memory/types.ts";

// A sanity cap, not a token-accurate limit (that depends on the model's
// tokenizer and the user's configured context window) — it exists to fail
// fast on pathological input instead of only finding out ~3 minutes later,
// when Ollama itself rejects a message that overflows its context length.
const MAX_MESSAGE_LENGTH = 20_000;

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
  thinkingRuns: ThinkingRun[],
): void {
  embedText(fullContent)
    .then((vector) =>
      addMessage(dataDir, chatId, "agent", fullContent, vector, {
        usedTools,
        steps,
        thinkingRuns,
      }),
    )
    .then(() => touchChat(dataDir, chatId))
    .catch((error) => {
      console.error("Failed to persist agent message:", error);
    });
}

// Opens a new run whenever the producing node changes (or on the very first
// delta) so a node that executes more than once in a turn ends up as
// separate runs instead of one merged blob — mirrors how `steps` accumulates
// one entry per node execution rather than collapsing repeats.
function appendThinkingDelta(
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

        if (typeof userText !== "string" || userText.trim().length === 0) {
          send("error", { message: "The 'message' field is required and must be a non-empty string." });
          return;
        }

        if (userText.length > MAX_MESSAGE_LENGTH) {
          send("error", {
            message: `The message is too long (${userText.length} characters, max ${MAX_MESSAGE_LENGTH}).`,
          });
          return;
        }

        const dataDir = hive.getConfig().get("dataDir");

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
        const thinkingRuns: ThinkingRun[] = [];

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
              appendThinkingDelta(thinkingRuns, reasoningChunk, metadata.langgraph_node);
              send("thinking_delta", {
                content: reasoningChunk,
                node: metadata.langgraph_node,
              });
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

        persistAgentMessageInBackground(
          dataDir,
          chatId,
          fullContent,
          usedTools,
          steps,
          thinkingRuns,
        );

        send("done", { content: fullContent, usedTools, steps, thinkingRuns });
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
