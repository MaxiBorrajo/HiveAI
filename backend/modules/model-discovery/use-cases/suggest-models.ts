import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { ResponseBuilder } from "../../../core/api/response.ts";
import { createChatModel } from "../../../core/ai/providers/create-chat-model.ts";
import { normalizeProviderError } from "../../../core/ai/providers/errors.ts";
import type { ModelRef } from "../../../core/ai/providers/types.ts";
import { invokeWithRetry } from "../../../core/ai/visual-builder/generation/generation-step.ts";
import type { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import { parseJudgeRef } from "../../executions/use-cases/grade-runs.ts";
import type { SearchResultItem } from "../types.ts";
import { defaultDeps, searchModels } from "./model-discovery.ts";

export const MAX_SUGGESTIONS = 6;
const MAX_QUERY_LENGTH = 500;
const POOL_PAGES = 3;

export interface SuggestBody {
  query?: unknown;
  model?: { provider?: string; model?: string; keyId?: string };
}

export interface ModelPick {
  name: string;
  reason: string;
}

export interface SuggestResult {
  items: SearchResultItem[];
  /** One short sentence per suggested model, keyed by `card.id` */
  reasons: Record<string, string>;
  /** Set when there is nothing to show */
  message?: string;
}

export interface SuggestDeps {
  pool: (hive: HiveMicrokernel) => Promise<SearchResultItem[]>;
  ask: (ref: ModelRef, query: string, pool: SearchResultItem[]) => Promise<ModelPick[]>;
}

/** Real, installable models (with their fit already computed) that the asked model chooses from. */
async function defaultPool(hive: HiveMicrokernel): Promise<SearchResultItem[]> {
  const deps = defaultDeps(hive);
  const items = new Map<string, SearchResultItem>();
  let cursor: string | undefined;
  for (let page = 0; page < POOL_PAGES; page++) {
    const result = await searchModels("", deps, { source: "ollama", sort: "downloads", cursor });
    for (const item of result.items) items.set(item.card.id, item);
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return [...items.values()];
}

const FIT_WORDS = { fits: "fits", slow: "runs slowly", no_fit: "too big" } as const;

export function describePool(pool: SearchResultItem[]): string {
  return pool
    .map(({ card, fit }) => {
      const caps = (["tools", "vision", "reasoning"] as const).filter((c) => card.capabilities[c]);
      const sizes = card.sizes?.length ? `${card.sizes.join("/")}B` : card.paramsBillions ? `${card.paramsBillions}B` : "?";
      const fitText = fit ? FIT_WORDS[fit.status] : "size unknown";
      return `- ${card.id} (${sizes}; ${caps.join(", ") || "chat"}; on this PC: ${fitText})`;
    })
    .join("\n");
}

const PicksSchema = z.object({
  models: z
    .array(
      z.object({
        name: z.string().describe("Exact model name from the list"),
        reason: z.string().describe("One short sentence on why it suits the request"),
      }),
    )
    .max(MAX_SUGGESTIONS),
});

async function defaultAsk(
  ref: ModelRef,
  query: string,
  pool: SearchResultItem[],
): Promise<ModelPick[]> {
  const model = (await createChatModel(ref, { temperature: 0.2, think: false }))
    .withStructuredOutput(PicksSchema, { name: "ModelSuggestions" });
  const system = `You help a user choose which local AI models to download.
Pick up to ${MAX_SUGGESTIONS} models for what the user describes, best first.
Rules:
- Choose ONLY from this list and copy the name exactly. Never invent a model.
- Prefer models that fit this PC; only pick one marked "too big" if nothing else is reasonable.
- Respect needed capabilities (e.g. vision for images, tools for tool use).
- If nothing in the list suits the request, return an empty list.
- Write each reason in the same language as the request.

Available models:
${describePool(pool)}`;
  const result = (await invokeWithRetry(
    model,
    [new SystemMessage(system), new HumanMessage(query)],
    "Model suggestions",
  )) as z.infer<typeof PicksSchema>;
  return result?.models ?? [];
}

const normalize = (name: string) => name.trim().toLowerCase().replace(/:.*$/, "");

/** Turns the model's picks into real pool entries. Unknown names are dropped, never guessed. */
export function resolvePicks(picks: ModelPick[], pool: SearchResultItem[]): SuggestResult {
  const byName = new Map(pool.map((item) => [normalize(item.card.id), item]));
  const items: SearchResultItem[] = [];
  const reasons: Record<string, string> = {};
  for (const pick of picks) {
    const item = byName.get(normalize(pick.name));
    if (!item || reasons[item.card.id] !== undefined) continue;
    items.push(item);
    reasons[item.card.id] = pick.reason.trim();
    if (items.length === MAX_SUGGESTIONS) break;
  }
  return items.length === 0
    ? { items, reasons, message: "No model in the library clearly matches that request." }
    : { items, reasons };
}

export async function handleSuggest(
  hive: HiveMicrokernel,
  body: SuggestBody,
  headers: Record<string, string>,
  deps: SuggestDeps = { pool: defaultPool, ask: defaultAsk },
): Promise<Response> {
  const fail = (message: string, status: number) =>
    ResponseBuilder.error([message], undefined, { headers, status });

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) return fail("Describe what you need the model for.", 400);
  if (query.length > MAX_QUERY_LENGTH) return fail(`The request is too long (max ${MAX_QUERY_LENGTH} characters).`, 400);
  const ref = parseJudgeRef(body.model as Parameters<typeof parseJudgeRef>[0]);
  if (!ref) return fail("Pick a model to ask.", 400);

  let pool: SearchResultItem[];
  try {
    pool = await deps.pool(hive);
  } catch {
    return fail("Could not load the model library.", 502);
  }
  if (pool.length === 0) return ResponseBuilder.success({ items: [], reasons: {}, message: "No models available to choose from." } satisfies SuggestResult, { headers });

  try {
    return ResponseBuilder.success(resolvePicks(await deps.ask(ref, query, pool), pool), { headers });
  } catch (error) {
    return fail(normalizeProviderError(error, ref.provider).message, 502);
  }
}
