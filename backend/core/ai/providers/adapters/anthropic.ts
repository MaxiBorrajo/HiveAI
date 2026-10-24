import { ChatAnthropic } from "@langchain/anthropic";
import { type BaseMessage, HumanMessage } from "@langchain/core/messages";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { z } from "zod";
import { RunnableLambda } from "@langchain/core/runnables";
import { getJson, type ProviderAdapter, toCloudModel } from "../adapter.ts";
import { validateWithGet } from "./validate.ts";
import {
  TOOLS_SUPPORTED,
  toolsUnknown,
  type ToolSupport,
} from "../tool-support.ts";

// langchain only knows per-model output caps for older ids and falls back to 4096
// for unlisted ones (e.g. claude-haiku-5-5), which truncates long outputs such as
// full HTML pages. Nodes stream their responses, so nodes may raise maxTokens past
// the 16384 the SDK accepts without streaming; this is only the default.
const DEFAULT_MAX_OUTPUT_TOKENS = 16384;

const headers = (apiKey: string) => ({
  "x-api-key": apiKey,
  "anthropic-version": "2023-06-01",
});

const rejectsTemperature = (model: string) =>
  /^claude-[a-z]+-([5-9]|\d{2,})(-|$)/.test(model);

// deno-lint-ignore no-explicit-any
const useAutoToolStructuredOutput = (llm: any) => {
  // deno-lint-ignore no-explicit-any
  llm.withStructuredOutput = (schema: any, config?: any) => {
    const name = config?.name ?? "extract";
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

function anthropicToolSupport(m: { capabilities?: unknown }): ToolSupport {
  return m.capabilities && typeof m.capabilities === "object"
    ? TOOLS_SUPPORTED
    : toolsUnknown("Anthropic did not describe this model's capabilities.");
}

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
    return (
      (json.data ?? []) as {
        id: string;
        display_name?: string;
        capabilities?: unknown;
      }[]
    ).map((m) => toCloudModel(m.id, m.display_name, anthropicToolSupport(m)));
  },

  createModel(model, apiKey, { temperature, maxTokens: requestedMaxTokens, think }) {
    const maxTokens = requestedMaxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
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
