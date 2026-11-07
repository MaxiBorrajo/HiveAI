import type { ModelRef } from "../../core/ai/providers/types.ts";

/** USD per one million tokens. */
export interface ModelPrice {
  input: number;
  output: number;
}

/**
 * Cloud prices, matched by model-name prefix (longest prefix wins), so a
 * dated or versioned id ("claude-sonnet-4-5-20250929") still finds its
 * family. These are list prices copied by hand from each provider's pricing
 * page — CHECK THEM before trusting a cost figure, and add a line here for
 * any model you evaluate that isn't covered. A model with no entry reports
 * its cost as unknown rather than guessing.
 *
 * Local (Ollama) models always cost 0.
 */
export const CLOUD_PRICES: Record<string, Record<string, ModelPrice>> = {
  anthropic: {
    "claude-opus": { input: 5, output: 25 },
    "claude-sonnet": { input: 3, output: 15 },
    "claude-haiku": { input: 1, output: 5 },
  },
  google: {
    "gemini-2.5-pro": { input: 1.25, output: 10 },
    "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
    "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  },
};

export function findPrice(ref: Pick<ModelRef, "provider" | "model">): ModelPrice | null {
  if (ref.provider === "ollama") return { input: 0, output: 0 };
  const table = CLOUD_PRICES[ref.provider] ?? {};
  const match = Object.keys(table)
    .filter((prefix) => ref.model.startsWith(prefix))
    .sort((a, b) => b.length - a.length)[0];
  return match ? table[match] : null;
}

/** Cost in USD of the given token counts, or null when the price is unknown. */
export function costUsd(
  ref: Pick<ModelRef, "provider" | "model">,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const price = findPrice(ref);
  if (!price) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

/** Sums costs where any unknown (null) makes the total unknown too. */
export function sumCosts(costs: (number | null | undefined)[]): number | null {
  let total = 0;
  for (const c of costs) {
    if (c === null || c === undefined) return null;
    total += c;
  }
  return total;
}

export function formatCost(cost: number | null | undefined): string {
  if (cost === null || cost === undefined) return "unknown";
  if (cost === 0) return "$0";
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}
