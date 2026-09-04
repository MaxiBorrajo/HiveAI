import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import type { BeePlugin } from "../../../../core/microkernel/bee-plugin.ts";
import {
  HiveMind,
  HiveAIState,
  type ChatStep,
} from "../../../../core/ai/strategy/SADER/graph.ts";

let chatHistory: BaseMessage[] = [];

// Streams the final answer token-by-token via Server-Sent Events, instead of
// waiting for the whole graph run to finish. LangGraph's "messages" stream
// mode emits every token from every LLM-backed node (Solver/AbstentionVerificator/
// Diagnostician included), so we filter to only forward tokens coming from the
// HiveQueenResponder node — the only one that produces user-facing text.
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

        const turnStart = chatHistory.length;
        chatHistory.push(new HumanMessage(userText));

        // Solver/Executor/Diagnostician can take a while before
        // HiveQueenResponder emits its first token. Tell the frontend to show
        // a "thinking" indicator immediately; it clears it on the first token.
        send("thinking", {});

        let fullContent = "";
        const steps: ChatStep[] = [];

        for await (const chunk of await HiveMind.stream(
          {
            messages: chatHistory,
            model,
            selectorModel,
            currentPrompt: userText,
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
            if (metadata.langgraph_node !== "HiveQueenResponder") continue;

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
          // pick up the accumulated step log along the way.
          steps.length = 0;
          steps.push(...payload.steps);
        }

        chatHistory.push(new AIMessage(fullContent));

        // Tools used during this turn (starting from the user's message)
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
