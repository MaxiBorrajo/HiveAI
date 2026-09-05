import type { GetModelsResponse } from "./types.ts";
import ollama from "ollama";

export async function getModels(): Promise<GetModelsResponse> {
  const { models } = await ollama.list();
  return models;
}

export async function handleGetPlugins(
  headers: Record<string, string>,
): Promise<Response> {
  const models = await getModels();
  return Response.json(models, { headers });
}
