import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import type { BeePlugin } from "../../../../core/microkernel/bee-plugin.ts";
import {
  HiveMind,
  HiveAIState,
  type ChatStep,
} from "../../../../core/ai/strategy/SADER/graph.ts";
import { resolveModelOptions } from "../../../modes/utils/resolveModelOptions.ts";

let chatHistory: BaseMessage[] = [];

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
        const userText = body.message;

        console.log(
          `/chat received. Active bees right now: [${hive
            .getRegisteredPlugins()
            .filter((p: BeePlugin) => hive.isActive(p.name))
            .map((p: BeePlugin) => p.name)
            .join(", ")}]`,
        );

        chatHistory.push(new HumanMessage(userText));

        send("thinking", {});

        const modelOptions = await resolveModelOptions(
          hive.getConfig().get("currentMode"),
        );

        let fullContent = "";
        const steps: ChatStep[] = [];

        for await (const chunk of await HiveMind.stream(
          {
            messages: chatHistory,
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

        chatHistory.push(new AIMessage(fullContent));

        const usedTools = Array.from(
          new Set(
            steps
              .filter((step) => step.node === "Executor")
              .map((step) => step.label),
          ),
        );

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
