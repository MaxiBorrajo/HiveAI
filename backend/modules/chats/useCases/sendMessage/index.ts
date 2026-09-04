import {
  HumanMessage,
  type BaseMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import type { BeePlugin } from "../../../../core/microkernel/bee-plugin.ts";
import { HiveMind } from "../../../../ai/strategy/SADER/graph.ts";

let chatHistory: BaseMessage[] = [];

export async function handleChat(
  hive: HiveMicrokernel,
  model: string,
  selectorModel: string,
  req: Request,
  headers: Record<string, string>,
): Promise<Response> {
  const body = await req.json();
  const userText = body.message;

  console.log(
    `/chat received. Active bees right now: [${hive
      .getRegisteredPlugins()
      .filter((p: BeePlugin) => hive.isActive(p.name))
      .map((p: BeePlugin) => p.name)
      .join(", ")}]`,
  );

  // Add only the new message to the history that lives in memory
  const turnStart = chatHistory.length;
  chatHistory.push(new HumanMessage(userText));

  const result = await HiveMind.invoke({
    messages: chatHistory,
    model,
    selectorModel,
    currentPrompt: userText
  });

  console.log(result.messages.slice(-1, -4));

  chatHistory = result.messages;

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

  const lastMessage = chatHistory[chatHistory.length - 1];

  return Response.json(
    { content: lastMessage.content, usedTools },
    { headers },
  );
}

