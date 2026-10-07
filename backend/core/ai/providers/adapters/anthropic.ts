import { ChatAnthropic } from "@langchain/anthropic";
import { getJson, type ProviderAdapter, toCloudModel } from "../adapter.ts";
import { validateWithGet } from "./validate.ts";

const headers = (apiKey: string) => ({
  "x-api-key": apiKey,
  "anthropic-version": "2023-06-01",
});

// Claude 5+ models reject any non-default temperature.
const rejectsTemperature = (model: string) =>
  /^claude-[a-z]+-([5-9]|\d{2,})(-|$)/.test(model);

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
      return new ChatAnthropic({
        model,
        apiKey,
        maxTokens,
        thinking: { type: "adaptive", display: "summarized" },
      } as ConstructorParameters<typeof ChatAnthropic>[0]);
    }
    return new ChatAnthropic({
      model,
      apiKey,
      maxTokens,
      ...(rejectsTemperature(model) ? {} : { temperature }),
    });
  },
};
