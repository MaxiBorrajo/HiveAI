import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";

/** Local models seen reasoning with thinking turned off. */
export async function getAlwaysThinkingModels(): Promise<ResponseEntity<string[]>> {
  const response = await apiClient.get("/api/model-settings/always-thinking");
  return response.data;
}

const EVENT = "hiveai:always-thinking";

/** A chat just found out that `model` reasons anyway. */
export function announceAlwaysThinking(model: string): void {
  globalThis.dispatchEvent(new CustomEvent(EVENT, { detail: model }));
}

export function onAlwaysThinking(listener: (model: string) => void): () => void {
  const handle = (event: Event) => listener((event as CustomEvent<string>).detail);
  globalThis.addEventListener(EVENT, handle);
  return () => globalThis.removeEventListener(EVENT, handle);
}
