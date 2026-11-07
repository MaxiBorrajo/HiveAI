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
  type LibraryClient,
  type LibraryModel,
  type LibraryTag,
  LibraryUnavailableError,
  getLibraryClient,
} from "../lib/ollama-library-client.ts";
import {
  estimateQ4Bytes,
  isChatCandidate,
  parseModel,
  parseQuantizations,
} from "../lib/parse-model.ts";
import { cleanReadme, summarizeReadme } from "../lib/readme-summary.ts";
import {
  OFFLINE_LIBRARY,
  OFFLINE_RECOMMENDED,
  RECOMMENDED_REPOS,
  TRUSTED_AUTHORS,
} from "../lib/recommended.ts";
import {
  type ModelCard,
  type ModelDetail,
  MODEL_SOURCES,
  type ModelSource,
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
  library: LibraryClient;
  profile: () => Promise<HardwareProfile>;
  fitContext: () => Promise<FitContext>;
}

export function defaultDeps(hive: HiveMicrokernel): DiscoveryDeps {
  return {
    hf: getHfClient(),
    library: getLibraryClient(),
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
  const [profile, ctx] = await Promise.all([deps.profile(), deps.fitContext()]);
  return (options.source ?? "ollama") === "ollama"
    ? searchLibrary(query, deps, options, profile, ctx)
    : searchHuggingFace(query, deps, options, profile, ctx);
}

/** Models of ollama.com/library: Ollama guarantees they run, so this is the default source. */
async function searchLibrary(
  query: string,
  deps: DiscoveryDeps,
  options: SearchOptions,
  profile: HardwareProfile,
  ctx: FitContext,
): Promise<SearchResult> {
  const filters = options.filters ?? {};
  const recommended = !query.trim() && (options.sort ?? "recommended") === "recommended";
  const categories = [
    ...(filters.tools || recommended ? ["tools"] : []),
    ...(filters.vision ? ["vision"] : []),
    ...(filters.reasoning ? ["thinking"] : []),
  ];
  try {
    const models = await deps.library.search(query, {
      sort: options.sort === "updated" ? "newest" : "popular",
      categories,
    });
    const items = models
      // embedding models cannot chat
      .filter((m) => !m.capabilities.includes("embedding"))
      .map((m) => libraryItem(m, profile, ctx))
      .filter((item) => matchesFilters(item, filters))
      .filter((item) => !recommended || (item.fit !== null && item.fit.status !== "no_fit"));
    return { offline: false, nextCursor: null, items };
  } catch (error) {
    if (!isSourceUnavailable(error)) throw error;
    return {
      offline: true,
      nextCursor: null,
      items: offlineLibrary(profile, ctx).filter((item) => matchesFilters(item, filters)),
    };
  }
}

function isSourceUnavailable(error: unknown): boolean {
  return error instanceof HfUnavailableError || error instanceof LibraryUnavailableError;
}

function libraryCard(m: LibraryModel, paramsBillions: number | null): ModelCard {
  return {
    source: "ollama",
    id: m.name,
    ollamaName: m.name,
    sizes: m.sizes,
    paramsBillions,
    architecture: null,
    contextLength: null,
    downloads: m.pulls,
    likes: 0,
    license: null,
    capabilities: {
      tools: m.capabilities.includes("tools"),
      vision: m.capabilities.includes("vision"),
      reasoning: m.capabilities.includes("thinking"),
    },
  };
}

/** A library model is published in several sizes: the card shows the largest one that fits this machine. */
function libraryItem(m: LibraryModel, profile: HardwareProfile, ctx: FitContext): SearchResultItem {
  const sizes = [...m.sizes].sort((a, b) => a - b);
  if (sizes.length === 0) return toItem(libraryCard(m, null), profile, ctx);
  const items = sizes.map((size) => toItem(libraryCard({ ...m, sizes }, size), profile, ctx));
  return [...items].reverse().find((i) => i.fit?.status === "fits") ?? items[0];
}

function offlineLibrary(profile: HardwareProfile, ctx: FitContext): SearchResultItem[] {
  return OFFLINE_LIBRARY.map((m) =>
    libraryItem({
      name: m.name,
      description: "",
      capabilities: m.tools ? ["tools"] : [],
      sizes: m.sizes,
      pulls: 0,
    }, profile, ctx)
  );
}

async function searchHuggingFace(
  query: string,
  deps: DiscoveryDeps,
  options: SearchOptions,
  profile: HardwareProfile,
  ctx: FitContext,
): Promise<SearchResult> {
  const filters = options.filters ?? {};
  const sort = options.sort ?? (query.trim() ? "downloads" : "recommended");
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
    if (!isSourceUnavailable(error)) throw error;
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
      source: "huggingface",
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

export function getModelDetail(
  id: string,
  deps: DiscoveryDeps,
  source: ModelSource = "ollama",
): Promise<ModelDetail> {
  return source === "ollama"
    ? getLibraryDetail(id, deps)
    : getHuggingFaceDetail(id, deps);
}

/** Tags that point at the same weights (e.g. "8b" and "8b-q4_K_M") are listed once, under the shortest name. */
export function dedupeTags(tags: LibraryTag[]): LibraryTag[] {
  const byDigest = new Map<string, LibraryTag>();
  for (const t of tags) {
    const known = byDigest.get(t.digest);
    const better = !known ||
      (known.tag === "latest" && t.tag !== "latest") ||
      (t.tag !== "latest" && t.tag.length < known.tag.length);
    if (better) byDigest.set(t.digest, t);
  }
  return [...byDigest.values()];
}

/** "8b-q8_0" -> 8; null for tags that do not start with a size such as "latest" */
function tagParams(tag: string): number | null {
  const m = /^(\d+(?:\.\d+)?)b(?:-|$)/.exec(tag);
  return m ? Number(m[1]) : null;
}

async function getLibraryDetail(name: string, deps: DiscoveryDeps): Promise<ModelDetail> {
  const [profile, ctx, detail] = await Promise.all([
    deps.profile(),
    deps.fitContext(),
    deps.library.getModel(name),
  ]);
  if (!detail) throw new Error("Model not found.");
  const tags = dedupeTags(detail.tags).sort((a, b) => a.sizeBytes - b.sizeBytes);
  const contextLength = detail.tags.find((t) => t.tag === "latest")?.contextLength ??
    tags[0]?.contextLength ?? null;
  const quantizations = tags.map((t) => ({
    quant: { name: t.tag, sizeBytes: t.sizeBytes, ollamaName: `${name}:${t.tag}` },
    fit: evaluateFit(profile, {
      sizeBytes: t.sizeBytes,
      paramsBillions: tagParams(t.tag),
      contextLength: t.contextLength ?? contextLength,
    }, ctx),
  }));
  // the biggest build that fits comfortably; fp16 builds are never the suggestion
  const best = [...quantizations].reverse().find((q) =>
    q.fit.status === "fits" && !q.quant.name.includes("fp16")
  ) ?? quantizations.find((q) => q.fit.status === "slow") ?? quantizations[0] ?? null;
  return {
    card: {
      ...libraryCard(detail.model, best ? tagParams(best.quant.name) : null),
      contextLength,
    },
    readmeSummary: detail.model.description,
    readme: "",
    quantizations,
    bestQuantization: best?.quant.name ?? null,
  };
}

async function getHuggingFaceDetail(repo: string, deps: DiscoveryDeps): Promise<ModelDetail> {
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
const LIBRARY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function parseSource(value: string | undefined): ModelSource | null {
  if (value === undefined || value === "") return "ollama";
  return MODEL_SOURCES.includes(value as ModelSource) ? (value as ModelSource) : null;
}

const MAX_CURSOR_LENGTH = 2048;

export async function handleSearch(
  hive: HiveMicrokernel,
  params: Record<string, string | undefined>,
  headers: Record<string, string>,
): Promise<Response> {
  const source = parseSource(params.source);
  if (!source) {
    return ResponseBuilder.error(["Invalid source."], undefined, { headers, status: 400 });
  }
  const sort = params.sort as SearchSort | undefined;
  if (sort !== undefined && !SEARCH_SORTS.includes(sort)) {
    return ResponseBuilder.error(["Invalid sort."], undefined, { headers, status: 400 });
  }
  if ((params.cursor?.length ?? 0) > MAX_CURSOR_LENGTH) {
    return ResponseBuilder.error(["Invalid cursor."], undefined, { headers, status: 400 });
  }
  return ResponseBuilder.success(
    await searchModels(params.q ?? "", defaultDeps(hive), {
      source,
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
  rawSource: string | undefined,
  headers: Record<string, string>,
): Promise<Response> {
  const source = parseSource(rawSource);
  const pattern = source === "huggingface" ? REPO_PATTERN : LIBRARY_PATTERN;
  if (!source || !repo || !pattern.test(repo)) {
    return ResponseBuilder.error(["Invalid model id."], undefined, {
      headers,
      status: 400,
    });
  }
  try {
    return ResponseBuilder.success(
      await getModelDetail(repo, defaultDeps(hive), source),
      { headers },
    );
  } catch (error) {
    const unavailable = isSourceUnavailable(error);
    return ResponseBuilder.error(
      [(error as Error).message],
      { offline: unavailable },
      { headers, status: unavailable ? 503 : 404 },
    );
  }
}
