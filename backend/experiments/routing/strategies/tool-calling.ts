import { ChatOllama } from "@langchain/ollama";
import { MODEL, TOOL_CALLING_PROMPT } from "../constants.ts";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { MockPlugin } from "../mock-plugins.ts";
import { tool } from "@langchain/core/tools";

export async function toolCalling(query: string, catalog: MockPlugin[]) {
  const toolCaller = new ChatOllama({
    model: MODEL,
    think: false,
    temperature: 0.0,
    numCtx: 8192,
  });

  const tools = catalog.map((c) =>
    tool(() => "Ejecutado", {
      name: c.name,
      description: c.description,
      schema: c.schema,
    }),
  )

  const modelWithTools = toolCaller.bindTools(tools)

  const response = await modelWithTools.invoke([
    new SystemMessage(TOOL_CALLING_PROMPT),
    new HumanMessage(query),
  ]);

  return response
}
