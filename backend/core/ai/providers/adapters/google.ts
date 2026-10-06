import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { getJson, type ProviderAdapter, toCloudModel } from "../adapter.ts";
import { validateWithGet } from "./validate.ts";

const headers = (apiKey: string) => ({ "x-goog-api-key": apiKey });
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export const googleAdapter: ProviderAdapter = {
  id: "google",
  label: "Google Gemini",

  validateKey: (apiKey, fetchFn) =>
    validateWithGet("google", `${BASE}?pageSize=1`, headers(apiKey), fetchFn),

  async listModels(apiKey, fetchFn) {
    const json = await getJson(`${BASE}?pageSize=100`, headers(apiKey), fetchFn);
    return (
      (json.models ?? []) as {
        name: string;
        displayName?: string;
        supportedGenerationMethods?: string[];
      }[]
    )
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) =>
        toCloudModel(m.name.replace(/^models\//, ""), m.displayName),
      );
  },

  createModel: (model, apiKey, { temperature, maxTokens }) =>
    new ChatGoogleGenerativeAI({
      model,
      apiKey,
      temperature,
      maxOutputTokens: maxTokens,
    }),
};
