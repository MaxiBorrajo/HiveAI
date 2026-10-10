import { ChatAnthropic } from "@langchain/anthropic";
import { type BaseMessage, HumanMessage } from "@langchain/core/messages";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { z } from "zod";
import { RunnableLambda } from "@langchain/core/runnables";
import { getJson, type ProviderAdapter, toCloudModel } from "../adapter.ts";
import { validateWithGet } from "./validate.ts";

const headers = (apiKey: string) => ({
  "x-api-key": apiKey,
  "anthropic-version": "2023-06-01",
});

// Claude 5+ models reject any non-default temperature.
const rejectsTemperature = (model: string) =>
  /^claude-[a-z]+-([5-9]|\d{2,})(-|$)/.test(model);

/*Este metodo es para que modelos +5 de anthropic puedan devolver structured output con tipos no estrictos como any o unknown. Lo que haces es tomar el llm actual de anthropic, definirle una tool de extract que es lo que permite el structured output, y luego manda el input del usuario. Luego revisa que llame a esta tool hasta 3 veces, si no lo hace, falla. */
// deno-lint-ignore no-explicit-any
const useAutoToolStructuredOutput = (llm: any) => {
  // deno-lint-ignore no-explicit-any
  llm.withStructuredOutput = (schema: any, config?: any) => {
    const name = config?.name ?? "extract";
    // Anthropic tool inputs must be objects: wrap primitive schemas (number/boolean/string).
    const wrapped = (toJsonSchema(schema) as { type?: string }).type !== "object";
    const toolSchema = wrapped ? z.object({ value: schema }) : schema;
    const bound = llm.bindTools(
      [{ name, description: "Return the structured result.", schema: toolSchema }],
      { tool_choice: "auto" },
    );

    return RunnableLambda.from(async (input: unknown) => {
      const base = typeof input === "string"
        ? [new HumanMessage(input)]
        : [...(input as BaseMessage[])];

      let messages = base;

      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await bound.invoke(messages);
        // deno-lint-ignore no-explicit-any
        const call = res.tool_calls?.find((c: any) => c.name === name);

        if (call) {
          const parsed = toolSchema.parse(call.args);
          return wrapped ? parsed.value : parsed;
        }
        messages = [
          ...base,
          new HumanMessage(`You must respond by calling the "${name}" tool.`),
        ];
      }

      throw new Error(`Model did not call the "${name}" tool.`);
    });
  };
  return llm;
};

export const anthropicAdapter: ProviderAdapter = {
  id: "anthropic",
  label: "Anthropic",

  validateKey: (apiKey, fetchFn) =>
    validateWithGet(
      "anthropic",
      "https://api.anthropic.com/v1/models?limit=1",
      headers(apiKey),
      fetchFn,
    ),

  async listModels(apiKey, fetchFn) {
    const json = await getJson(
      "https://api.anthropic.com/v1/models?limit=100",
      headers(apiKey),
      fetchFn,
    );
    return ((json.data ?? []) as { id: string; display_name?: string }[]).map(
      (m) => toCloudModel(m.id, m.display_name),
    );
  },

  createModel(model, apiKey, { temperature, maxTokens, think }) {
    if (think) {
      const llm = new ChatAnthropic({
        model,
        apiKey,
        maxTokens,
        thinking: { type: "adaptive", display: "summarized" },
      } as ConstructorParameters<typeof ChatAnthropic>[0]);
      return rejectsTemperature(model) ? useAutoToolStructuredOutput(llm) : llm;
    }
    const llm = new ChatAnthropic({
      model,
      apiKey,
      maxTokens,
      ...(rejectsTemperature(model) ? {} : { temperature }),
    });
    return rejectsTemperature(model) ? useAutoToolStructuredOutput(llm) : llm;
  },
};
