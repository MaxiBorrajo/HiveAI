import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { getJson, type ProviderAdapter, toCloudModel } from "../adapter.ts";
import { validateWithGet } from "./validate.ts";
import {
  toolsUnknown,
  toolsUnsupported,
  type ToolSupport,
} from "../tool-support.ts";

const headers = (apiKey: string) => ({ "x-goog-api-key": apiKey });
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Models that accept generateContent but only produce audio or images.
const NON_CHAT_NAME = /(^|-)(tts|image|imagen|embedding|aqa)(-|$)/i;

// The Gemini models endpoint lists generation methods but no "tools" flag:
// non-chat models are told apart, chat models stay unknown.
function googleToolSupport(
  name: string,
  methods: string[] | undefined,
): ToolSupport {
  if (!methods?.includes("generateContent")) {
    return toolsUnsupported("Not a chat model: it cannot generate text responses.");
  }
  if (NON_CHAT_NAME.test(name)) {
    return toolsUnsupported(
      "Not a chat model: it generates audio, images or embeddings.",
    );
  }
  return toolsUnknown("Google does not report tool calling support per model.");
}

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
    ).map((m) => {
      const name = m.name.replace(/^models\//, "");
      return toCloudModel(
        name,
        m.displayName,
        googleToolSupport(name, m.supportedGenerationMethods),
      );
    });
  },

  createModel: (model, apiKey, { temperature, maxTokens }) =>
    new ChatGoogleGenerativeAI({
      model,
      apiKey,
      temperature,
      maxOutputTokens: maxTokens,
    }),
};
