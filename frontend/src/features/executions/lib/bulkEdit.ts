import type { GraphNode } from "../types";

/** The model an LLM node runs on; no `provider` means Ollama. */
export interface ModelSetting {
  model: string;
  provider?: string;
  keyId?: string;
}

/**
 * Changes made to several LLM nodes at once. Only the settings it makes sense
 * to share: prompts, inputs and outputs stay each node's own. A field left
 * undefined keeps whatever each node has.
 */
export interface BulkEdit {
  /** null: back to the default model (the one picked in the chat). */
  model?: ModelSetting | null;
  /** null: back to the model's default. */
  maxTokens?: number | null;
  /** Plugin name → true to equip it on every node, false to take it off. */
  plugins?: Record<string, boolean>;
}

export type Shared<T> = { mixed: false; value: T } | { mixed: true };

/** The value every item agrees on, or `mixed` when they differ. */
export function shared<T>(values: T[], same: (a: T, b: T) => boolean = Object.is): Shared<T> {
  const [first, ...rest] = values;
  return rest.every((v) => same(first, v)) ? { mixed: false, value: first } : { mixed: true };
}

export function modelOf(config: Record<string, any> | undefined): ModelSetting | null {
  if (!config?.model) return null;
  return {
    model: config.model,
    ...(config.provider ? { provider: config.provider } : {}),
    ...(config.keyId ? { keyId: config.keyId } : {}),
  };
}

export function sameModel(a: ModelSetting | null, b: ModelSetting | null): boolean {
  return a?.model === b?.model && a?.provider === b?.provider && a?.keyId === b?.keyId;
}

export function equippedPlugins(config: Record<string, any> | undefined): string[] {
  return Array.isArray(config?.plugins) ? config.plugins : [];
}

export function isEmptyEdit(edit: BulkEdit): boolean {
  return edit.model === undefined &&
    edit.maxTokens === undefined &&
    Object.keys(edit.plugins ?? {}).length === 0;
}

export function applyBulkEdit(config: Record<string, any>, edit: BulkEdit): Record<string, any> {
  let next = { ...config };
  if (edit.model !== undefined) {
    const { provider: _p, keyId: _k, ...rest } = next;
    next = edit.model ? { ...rest, ...edit.model } : { ...rest, model: undefined };
  }
  if (edit.maxTokens !== undefined) next.maxTokens = edit.maxTokens ?? undefined;
  if (edit.plugins && Object.keys(edit.plugins).length > 0) {
    const kept = equippedPlugins(config).filter((name) => edit.plugins![name] !== false);
    const added = Object.entries(edit.plugins)
      .filter(([name, on]) => on && !kept.includes(name))
      .map(([name]) => name);
    next.plugins = [...kept, ...added];
  }
  return next;
}

/** The nodes a bulk edit changes: only LLM (and agent) nodes have these settings. */
export function bulkEditable(nodes: GraphNode[]): GraphNode[] {
  return nodes.filter((n) => n.type === "llm");
}
