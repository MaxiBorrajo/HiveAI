import { ResponseBuilder } from "../../../core/api/response.ts";
import type { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import { detectHardware } from "../../hardware/lib/detect-hardware.ts";
import { evaluateFit, evaluateQuants } from "../../hardware/use-cases/evaluate-compatibility.ts";
import { getFitContext } from "../../hardware/use-cases/get-fit-context.ts";
import type { FitContext, HardwareProfile } from "../../hardware/types.ts";
import {
  getHfClient,
  type HfClient,
  type HfModel,
  type HfSort,
  HfUnavailableError,
} from "../lib/hf-client.ts";
import {
  estimateQ4Bytes,
  isChatCandidate,
  parseModel,
  parseQuantizations,
} from "../lib/parse-model.ts";
import { cleanReadme, summarizeReadme } from "../lib/readme-summary.ts";
import { OFFLINE_RECOMMENDED, RECOMMENDED_REPOS, TRUSTED_AUTHORS } from "../lib/recommended.ts";
import {
  type ModelCard,
  type ModelDetail,
  type SearchFilters,
  type SearchOptions,
  type SearchResult,
  type SearchResultItem,
  SEARCH_SORTS,
  type SearchSort,
} from "../types.ts";

/** results wanted per request, and how many Hugging Face pages one request may read to get them */
const PAGE_SIZE = 12;
const UPSTREAM_LIMIT = 30;
const MAX_UPSTREAM_PAGES = 4;
/** live additions to "Recommended" */
const LIVE_RECOMMENDED = 8;
const LIVE_PER_AUTHOR = 30;

const HF_SORT: Record<Exclude<SearchSort, "recommended">, HfSort> = {
  trending: "trendingScore",
  downloads: "downloads",
  likes: "likes",
  updated: "lastModified",
};

function matchesFilters(item: SearchResultItem, f: SearchFilters): boolean {
  const caps = item.card.capabilities;
  if (f.tools && !caps.tools) return false;
  if (f.vision && !caps.vision) return false;
  if (f.reasoning && !caps.reasoning) return false;
  if (f.fitsOnly && (!item.fit || item.fit.status === "no_fit")) return false;
  return true;
}

export interface DiscoveryDeps {
  hf: HfClient;
  profile: () => Promise<HardwareProfile>;
  fitContext: () => Promise<FitContext>;
}

export function defaultDeps(hive: HiveMicrokernel): DiscoveryDeps {
  return {
    hf: getHfClient(),
    profile: () => detectHardware(),
    fitContext: async () => (await getFitContext(hive)).context,
  };
}

function toItem(
  card: ModelCard,
  profile: HardwareProfile,
  ctx: FitContext,
): SearchResultItem {
  const estimatedQ4Bytes = estimateQ4Bytes(card.paramsBillions);
  return {
    card,
    estimatedQ4Bytes,
    fit: estimatedQ4Bytes === null ? null : evaluateFit(profile, {
      sizeBytes: estimatedQ4Bytes,
      paramsBillions: card.paramsBillions,
      contextLength: card.contextLength,
    }, ctx),
  };
}

/**
 * The most downloaded tool-capable models of trusted publishers that run on this machine.
 * Best effort: a publisher that cannot be read is skipped, the curated list still shows.
 */
async function liveRecommended(
  deps: DiscoveryDeps,
  profile: HardwareProfile,
  ctx: FitContext,
): Promise<SearchResultItem[]> {
  const pages = await Promise.all(
    TRUSTED_AUTHORS.map((author) =>
      deps.hf
        .search("", { author, sort: "downloads", limit: LIVE_PER_AUTHOR })
        .then((page) => page.models)
        .catch(() => [] as HfModel[])
    ),
  );
  return pages
    .flat()
    .filter(isChatCandidate)
    .map((m) => toItem(parseModel(m), profile, ctx))
    .filter((i) => i.card.capabilities.tools && i.fit !== null && i.fit.status !== "no_fit")
    .sort((a, b) => b.card.downloads - a.card.downloads)
    .slice(0, LIVE_RECOMMENDED);
}

export async function searchModels(
  query: string,
  deps: DiscoveryDeps,
  options: SearchOptions = {},
): Promise<SearchResult> {
  const filters = options.filters ?? {};
  const sort = options.sort ?? (query.trim() ? "downloads" : "recommended");
  const [profile, ctx] = await Promise.all([deps.profile(), deps.fitContext()]);
  try {
    if (sort === "recommended" && !query.trim()) {
      const [curated, live] = await Promise.all([
        Promise.all(
          RECOMMENDED_REPOS.map((repo) =>
            deps.hf.getModel(repo).catch((error) => {
              // a repo that was removed should not hide the rest, but being offline must surface
              if (error instanceof HfUnavailableError) throw error;
              return null;
            })
          ),
        ),
        liveRecommended(deps, profile, ctx),
      ]);
      const seen = new Set<string>();
      const items = [
        ...curated.filter((m): m is HfModel => m !== null).filter(isChatCandidate).map((m) =>
          toItem(parseModel(m), profile, ctx)
        ),
        ...live,
      ].filter((item) => !seen.has(item.card.id) && !!seen.add(item.card.id));
      return {
        offline: false,
        nextCursor: null,
        items: items.filter((item) => matchesFilters(item, filters)),
      };
    }

    // filters run after the fetch (Hugging Face cannot filter on tool support), so one request may
    // read several upstream pages until enough results survive
    const items: SearchResultItem[] = [];
    const seen = new Set<string>();
    let cursor: string | null = options.cursor ?? null;
    for (let page = 0; page < MAX_UPSTREAM_PAGES && items.length < PAGE_SIZE; page++) {
      const result = await deps.hf.search(query, {
        sort: HF_SORT[sort === "recommended" ? "downloads" : sort],
        limit: UPSTREAM_LIMIT,
        cursor: cursor ?? undefined,
      });
      cursor = result.nextCursor;
      for (const model of result.models) {
        if (seen.has(model.id) || !isChatCandidate(model)) continue;
        seen.add(model.id);
        const item = toItem(parseModel(model), profile, ctx);
        if (matchesFilters(item, filters)) items.push(item);
      }
      if (!cursor) break;
    }
    return { offline: false, nextCursor: cursor, items };
  } catch (error) {
    if (!(error instanceof HfUnavailableError)) throw error;
    return {
      offline: true,
      nextCursor: null,
      items: offlineRecommended(profile, ctx).filter((item) => matchesFilters(item, filters)),
    };
  }
}

export function offlineRecommended(
  profile: HardwareProfile,
  ctx: FitContext,
): SearchResultItem[] {
  return OFFLINE_RECOMMENDED.map((m) =>
    toItem({
      id: m.id,
      ollamaName: `hf.co/${m.id}`,
      paramsBillions: m.params,
      architecture: null,
      contextLength: m.context,
      downloads: 0,
      likes: 0,
      license: null,
      capabilities: { tools: m.tools, vision: false, reasoning: false },
    }, profile, ctx)
  );
}

export async function getModelDetail(
  repo: string,
  deps: DiscoveryDeps,
): Promise<ModelDetail> {
  const [profile, ctx, model, tree, readme] = await Promise.all([
    deps.profile(),
    deps.fitContext(),
    deps.hf.getModel(repo),
    deps.hf.getTree(repo),
    deps.hf.getReadme(repo),
  ]);
  const card = parseModel(model);
  const quants = parseQuantizations(repo, tree);
  const { all, best } = evaluateQuants(profile, quants, {
    paramsBillions: card.paramsBillions,
    contextLength: card.contextLength,
  }, ctx);
  return {
    card,
    readmeSummary: summarizeReadme(readme),
    readme: cleanReadme(readme),
    quantizations: all,
    bestQuantization: best?.quant.name ?? null,
  };
}

const REPO_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

const MAX_CURSOR_LENGTH = 2048;

export async function handleSearch(
  hive: HiveMicrokernel,
  params: Record<string, string | undefined>,
  headers: Record<string, string>,
): Promise<Response> {
  const sort = params.sort as SearchSort | undefined;
  if (sort !== undefined && !SEARCH_SORTS.includes(sort)) {
    return ResponseBuilder.error(["Invalid sort."], undefined, { headers, status: 400 });
  }
  if ((params.cursor?.length ?? 0) > MAX_CURSOR_LENGTH) {
    return ResponseBuilder.error(["Invalid cursor."], undefined, { headers, status: 400 });
  }
  return ResponseBuilder.success(
    await searchModels(params.q ?? "", defaultDeps(hive), {
      sort,
      cursor: params.cursor || undefined,
      filters: {
        tools: params.tools === "1",
        vision: params.vision === "1",
        reasoning: params.reasoning === "1",
        fitsOnly: params.fits === "1",
      },
    }),
    { headers },
  );
}

export async function handleDetail(
  hive: HiveMicrokernel,
  repo: string | undefined,
  headers: Record<string, string>,
): Promise<Response> {
  if (!repo || !REPO_PATTERN.test(repo)) {
    return ResponseBuilder.error(["Invalid model id."], undefined, {
      headers,
      status: 400,
    });
  }
  try {
    return ResponseBuilder.success(
      await getModelDetail(repo, defaultDeps(hive)),
      { headers },
    );
  } catch (error) {
    const unavailable = error instanceof HfUnavailableError;
    return ResponseBuilder.error(
      [(error as Error).message],
      { offline: unavailable },
      { headers, status: unavailable ? 503 : 404 },
    );
  }
}
