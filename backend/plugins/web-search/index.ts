import { z } from "zod";
import type {
  BeeContext,
  BeePlugin,
  SelectionTestCase,
  ExecutionTestCase,
} from "./bee-plugin.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 12_000;
const DEFAULT_SEARCH_LIMIT = 5;
const MAX_SEARCH_LIMIT = 10;

// DuckDuckGo pacing. All DDG requests of the whole process go through ONE queue,
// so an agent that fires several searches in parallel cannot burst the endpoint
// (that burst is what gets the IP flagged as automated traffic).
const DDG_MIN_INTERVAL_MS = 3_000;
const DDG_JITTER_MS = 1_500;
const DDG_BLOCK_COOLDOWN_MS = 45_000;
const DDG_MAX_COOLDOWN_WAIT_MS = 20_000;
const DDG_MAX_ATTEMPTS = 3;
const DDG_ATTEMPT_ORDER = ["html", "lite", "html"] as const;

// Identical queries inside this window are answered from memory (saves quota).
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 200;

const DDG_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
];

// ---------------------------------------------------------------------------
// Schema & types
// ---------------------------------------------------------------------------

const TIME_RANGES = ["day", "week", "month", "year"] as const;
type TimeRange = (typeof TIME_RANGES)[number];

const searchSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "The search query. Supports quotes for exact phrases, site:domain.com to restrict to a site, and -word to exclude a term. Keep it short (3-8 words plus operators). Do not chain many OR clauses.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_SEARCH_LIMIT)
    .optional()
    .describe(
      `Maximum number of results to return (default ${DEFAULT_SEARCH_LIMIT}, max ${MAX_SEARCH_LIMIT}).`,
    ),
  time_range: z
    .enum(TIME_RANGES)
    .optional()
    .describe(
      "Only return pages from the last day, week, month or year. Use 'year' to prioritise recent discussions. Omit for no date filter.",
    ),
});

type WebSearchSchema = typeof searchSchema;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  date?: string;
}

type Outcome =
  | { ok: true; results: SearchResult[]; extras?: string[] }
  | { ok: false; error: string };

type ProviderName = "serper" | "tavily" | "brave" | "searxng" | "duckduckgo";

const PROVIDER_LABEL: Record<ProviderName, string> = {
  serper: "Serper (Google)",
  tavily: "Tavily",
  brave: "Brave Search",
  searxng: "SearXNG",
  duckduckgo: "DuckDuckGo",
};

const AUTO_ORDER: ProviderName[] = [
  "serper",
  "tavily",
  "brave",
  "searxng",
  "duckduckgo",
];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  url: string,
  ms: number,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
  };
  return text.replace(
    /&#x([0-9a-f]+);|&#(\d+);|&(?:amp|lt|gt|quot|apos|nbsp);|&#39;/gi,
    (m, hex, dec) => {
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      if (dec) return String.fromCodePoint(Number(dec));
      return named[m.toLowerCase()] ?? m;
    },
  );
}

function cleanText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function netError(provider: string, error: unknown): Outcome {
  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      ok: false,
      error: `${provider} timed out after ${FETCH_TIMEOUT_MS}ms.`,
    };
  }
  const detail = error instanceof Error ? error.message : String(error);
  return { ok: false, error: `${provider} request failed: ${detail}` };
}

async function httpError(provider: string, res: Response): Promise<string> {
  let detail = "";
  try {
    detail = (await res.text()).replace(/\s+/g, " ").slice(0, 200);
  } catch {
    // ignore
  }
  const hint = res.status === 401 || res.status === 403
    ? " (check the API key)"
    : res.status === 402
    ? " (out of credits)"
    : res.status === 429
    ? " (rate limit or quota exhausted)"
    : "";
  return `${provider} returned HTTP ${res.status}${hint}. ${detail}`.trim();
}

async function readJson<T>(
  provider: string,
  res: Response,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, error: `${provider} did not return valid JSON.` };
  }
}

function normalizeUrlKey(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|ref$)/i.test(key)) u.searchParams.delete(key);
    }
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${
      u.pathname.replace(/\/+$/, "")
    }${u.search}`;
  } catch {
    return rawUrl;
  }
}

function dedupeResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of results) {
    const key = normalizeUrlKey(r.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Result cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  at: number;
  provider: ProviderName;
  results: SearchResult[];
  extras?: string[];
}

const searchCache = new Map<string, CacheEntry>();

function cacheGet(key: string): CacheEntry | undefined {
  const hit = searchCache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    searchCache.delete(key);
    return undefined;
  }
  return hit;
}

function cacheSet(key: string, entry: Omit<CacheEntry, "at">): void {
  if (searchCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = searchCache.keys().next().value;
    if (oldest !== undefined) searchCache.delete(oldest);
  }
  searchCache.set(key, { ...entry, at: Date.now() });
}

// ---------------------------------------------------------------------------
// Serper (Google results)  https://serper.dev
// ---------------------------------------------------------------------------

const SERPER_TBS: Record<TimeRange, string> = {
  day: "qdr:d",
  week: "qdr:w",
  month: "qdr:m",
  year: "qdr:y",
};

interface SerperResponse {
  organic?: Array<
    { title?: string; link?: string; snippet?: string; date?: string }
  >;
  peopleAlsoAsk?: Array<{ question?: string }>;
  relatedSearches?: Array<{ query?: string }>;
}

async function searchSerper(
  apiKey: string,
  query: string,
  limit: number,
  timeRange?: TimeRange,
): Promise<Outcome> {
  const body: Record<string, unknown> = { q: query, num: limit };
  if (timeRange) body.tbs = SERPER_TBS[timeRange];

  let res: Response;
  try {
    res = await fetchWithTimeout("https://google.serper.dev/search", FETCH_TIMEOUT_MS, {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return netError("Serper", error);
  }
  if (!res.ok) return { ok: false, error: await httpError("Serper", res) };

  const parsed = await readJson<SerperResponse>("Serper", res);
  if (!parsed.ok) return parsed;

  const results: SearchResult[] = (parsed.data.organic ?? [])
    .filter((r) => r.link)
    .slice(0, limit)
    .map((r) => ({
      title: r.title ?? "",
      url: r.link as string,
      snippet: r.snippet ?? "",
      date: r.date,
    }));

  const extras: string[] = [];
  const paa = (parsed.data.peopleAlsoAsk ?? [])
    .map((p) => p.question)
    .filter((q): q is string => !!q)
    .slice(0, 6);
  if (paa.length) {
    extras.push(`People also ask:\n${paa.map((q) => `- ${q}`).join("\n")}`);
  }
  const related = (parsed.data.relatedSearches ?? [])
    .map((p) => p.query)
    .filter((q): q is string => !!q)
    .slice(0, 6);
  if (related.length) {
    extras.push(`Related searches:\n${related.map((q) => `- ${q}`).join("\n")}`);
  }

  return { ok: true, results, extras };
}

// ---------------------------------------------------------------------------
// Tavily  https://tavily.com
// ---------------------------------------------------------------------------

interface TavilyResponse {
  results?: Array<
    { title?: string; url?: string; content?: string; published_date?: string }
  >;
}

async function searchTavily(
  apiKey: string,
  query: string,
  limit: number,
  timeRange?: TimeRange,
): Promise<Outcome> {
  // Tavily has no site: operator: turn plain domains into include_domains.
  const domains: string[] = [];
  const cleanQuery = query
    .replace(/\bsite:(\S+)/gi, (whole, site: string) => {
      if (/^[a-z0-9.-]+$/i.test(site)) {
        domains.push(site);
        return "";
      }
      return whole; // site:reddit.com/r/foo -> leave it in the text
    })
    .replace(/\s+/g, " ")
    .trim() || query;

  const body: Record<string, unknown> = {
    query: cleanQuery,
    max_results: limit,
    search_depth: "basic",
  };
  if (domains.length) body.include_domains = domains;
  if (timeRange) body.time_range = timeRange;

  let res: Response;
  try {
    res = await fetchWithTimeout("https://api.tavily.com/search", FETCH_TIMEOUT_MS, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return netError("Tavily", error);
  }
  if (!res.ok) return { ok: false, error: await httpError("Tavily", res) };

  const parsed = await readJson<TavilyResponse>("Tavily", res);
  if (!parsed.ok) return parsed;

  return {
    ok: true,
    results: (parsed.data.results ?? [])
      .filter((r) => r.url)
      .slice(0, limit)
      .map((r) => ({
        title: r.title ?? "",
        url: r.url as string,
        snippet: (r.content ?? "").replace(/\s+/g, " ").slice(0, 500),
        date: r.published_date,
      })),
  };
}

// ---------------------------------------------------------------------------
// Brave Search API  https://brave.com/search/api
// ---------------------------------------------------------------------------

const BRAVE_FRESHNESS: Record<TimeRange, string> = {
  day: "pd",
  week: "pw",
  month: "pm",
  year: "py",
};

interface BraveResponse {
  web?: {
    results?: Array<
      { title?: string; url?: string; description?: string; age?: string }
    >;
  };
}

async function searchBrave(
  apiKey: string,
  query: string,
  limit: number,
  timeRange?: TimeRange,
): Promise<Outcome> {
  const params = new URLSearchParams({ q: query, count: String(limit) });
  if (timeRange) params.set("freshness", BRAVE_FRESHNESS[timeRange]);

  let res: Response;
  try {
    res = await fetchWithTimeout(
      `https://api.search.brave.com/res/v1/web/search?${params}`,
      FETCH_TIMEOUT_MS,
      { headers: { Accept: "application/json", "X-Subscription-Token": apiKey } },
    );
  } catch (error) {
    return netError("Brave Search", error);
  }
  if (!res.ok) return { ok: false, error: await httpError("Brave Search", res) };

  const parsed = await readJson<BraveResponse>("Brave Search", res);
  if (!parsed.ok) return parsed;

  return {
    ok: true,
    results: (parsed.data.web?.results ?? [])
      .filter((r) => r.url)
      .slice(0, limit)
      .map((r) => ({
        title: cleanText(r.title ?? ""),
        url: r.url as string,
        snippet: cleanText(r.description ?? ""),
        date: r.age,
      })),
  };
}

// ---------------------------------------------------------------------------
// SearXNG (self hosted)
// ---------------------------------------------------------------------------

interface SearxResponse {
  results?: Array<
    { title?: string; url?: string; content?: string; publishedDate?: string }
  >;
}

async function searchSearxng(
  instanceUrl: string,
  query: string,
  limit: number,
  timeRange?: TimeRange,
): Promise<Outcome> {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    categories: "general",
  });
  if (timeRange) params.set("time_range", timeRange);
  const url = `${instanceUrl.replace(/\/$/, "")}/search?${params}`;

  let res: Response;
  try {
    res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS, {
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    return netError("SearXNG", error);
  }
  if (!res.ok) return { ok: false, error: await httpError("SearXNG", res) };

  const parsed = await readJson<SearxResponse>("SearXNG", res);
  if (!parsed.ok) {
    return {
      ok: false,
      error:
        "SearXNG did not return valid JSON. Check that 'json' is enabled in settings.yml under search.formats.",
    };
  }

  return {
    ok: true,
    results: (parsed.data.results ?? [])
      .filter((r) => r.url)
      .slice(0, limit)
      .map((r) => ({
        title: r.title ?? "",
        url: r.url as string,
        snippet: (r.content ?? "").replace(/\s+/g, " "),
        date: r.publishedDate,
      })),
  };
}

// ---------------------------------------------------------------------------
// DuckDuckGo (no API key; the fallback of last resort)
// ---------------------------------------------------------------------------

const DDG_DF: Record<TimeRange, string> = {
  day: "d",
  week: "w",
  month: "m",
  year: "y",
};

let ddgChain: Promise<void> = Promise.resolve();
let ddgNextSlot = 0;
let ddgCooldownUntil = 0;

/** Serialises every DDG request in the process and spaces them out. */
function acquireDdgSlot(): Promise<void> {
  const run = ddgChain.then(async () => {
    const now = Date.now();
    const cooldownWait = Math.min(
      Math.max(0, ddgCooldownUntil - now),
      DDG_MAX_COOLDOWN_WAIT_MS,
    );
    const slotWait = Math.max(0, ddgNextSlot - now);
    const wait = Math.max(cooldownWait, slotWait);
    if (wait > 0) await sleep(wait);
    ddgNextSlot = Date.now() + DDG_MIN_INTERVAL_MS +
      Math.random() * DDG_JITTER_MS;
  });
  ddgChain = run.catch(() => {});
  return run;
}

function pickRandomUserAgent(): string {
  return DDG_USER_AGENTS[Math.floor(Math.random() * DDG_USER_AGENTS.length)];
}

function buildDdgHeaders(userAgent: string): Record<string, string> {
  // No Accept-Encoding on purpose: the runtime negotiates and decodes it itself.
  return {
    "User-Agent": userAgent,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://duckduckgo.com/",
    "Upgrade-Insecure-Requests": "1",
    DNT: "1",
  };
}

function resolveDdgUrl(rawHref: string): string {
  const uddg = rawHref.match(/[?&]uddg=([^&]+)/);
  if (uddg) {
    try {
      return decodeURIComponent(uddg[1]);
    } catch {
      return uddg[1];
    }
  }
  return rawHref.startsWith("//") ? `https:${rawHref}` : rawHref;
}

function isAdUrl(url: string): boolean {
  return /duckduckgo\.com\/y\.js/.test(url) || /[?&]ad_provider=/.test(url);
}

/**
 * Parses html.duckduckgo.com. Each snippet is looked up inside the slice that
 * belongs to ITS result, so a result without snippet no longer shifts the
 * snippets of all the following ones.
 */
export function parseDdgHtml(html: string): SearchResult[] {
  const anchorRe =
    /<a\b([^>]*\bclass="[^"]*\bresult__a\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/g;
  const matches = [...html.matchAll(anchorRe)];
  const out: SearchResult[] = [];

  matches.forEach((m, i) => {
    const href = m[1].match(/\bhref="([^"]*)"/)?.[1];
    if (!href) return;
    const start = (m.index ?? 0) + m[0].length;
    const end = matches[i + 1]?.index ?? html.length;
    const chunk = html.slice(start, end);
    const snippet = chunk.match(
      /<(?:a|div|td)\b[^>]*\bclass="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/,
    )?.[1] ?? "";
    const url = resolveDdgUrl(decodeEntities(href));
    if (isAdUrl(url)) return;
    out.push({ title: cleanText(m[2]), url, snippet: cleanText(snippet) });
  });
  return out;
}

/** Parses lite.duckduckgo.com (table based markup, single or double quotes). */
export function parseDdgLite(html: string): SearchResult[] {
  const anchorRe =
    /<a\b([^>]*\bclass=['"][^'"]*\bresult-link\b[^'"]*['"][^>]*)>([\s\S]*?)<\/a>/g;
  const matches = [...html.matchAll(anchorRe)];
  const out: SearchResult[] = [];

  matches.forEach((m, i) => {
    const href = m[1].match(/\bhref=['"]([^'"]*)['"]/)?.[1];
    if (!href) return;
    const start = (m.index ?? 0) + m[0].length;
    const end = matches[i + 1]?.index ?? html.length;
    const chunk = html.slice(start, end);
    const snippet = chunk.match(
      /class=['"][^'"]*\bresult-snippet\b[^'"]*['"][^>]*>([\s\S]*?)<\/td>/,
    )?.[1] ?? "";
    const url = resolveDdgUrl(decodeEntities(href));
    if (isAdUrl(url)) return;
    out.push({ title: cleanText(m[2]), url, snippet: cleanText(snippet) });
  });
  return out;
}

type DdgAttempt =
  | { kind: "ok"; results: SearchResult[] }
  | { kind: "blocked" }
  | { kind: "error"; error: string };

async function ddgAttempt(
  endpoint: "html" | "lite",
  query: string,
  timeRange?: TimeRange,
): Promise<DdgAttempt> {
  const headers = buildDdgHeaders(pickRandomUserAgent());
  const params = new URLSearchParams({ q: query });
  if (timeRange) params.set("df", DDG_DF[timeRange]);

  let res: Response;
  try {
    if (endpoint === "html") {
      res = await fetchWithTimeout(
        `https://html.duckduckgo.com/html/?${params}`,
        FETCH_TIMEOUT_MS,
        { headers },
      );
    } else {
      res = await fetchWithTimeout("https://lite.duckduckgo.com/lite/", FETCH_TIMEOUT_MS, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "https://lite.duckduckgo.com",
          Referer: "https://lite.duckduckgo.com/",
        },
        body: params.toString(),
      });
    }
  } catch (error) {
    const out = netError("DuckDuckGo", error);
    return { kind: "error", error: out.ok ? "unknown error" : out.error };
  }

  // 202 is what DDG answers when it flags the request as a bot.
  if (res.status === 202 || res.status === 403 || res.status === 429) {
    await res.body?.cancel();
    return { kind: "blocked" };
  }
  if (!res.ok) {
    await res.body?.cancel();
    return { kind: "error", error: `DuckDuckGo returned HTTP ${res.status}.` };
  }

  const html = await res.text();
  const results = endpoint === "html" ? parseDdgHtml(html) : parseDdgLite(html);

  // Only call it a block when there are NO results: a normal page about
  // "anomaly detection" legitimately contains the word "anomaly".
  if (
    results.length === 0 &&
    /anomaly|unusual traffic|captcha|are you a robot|bots use duckduckgo/i
      .test(html)
  ) {
    return { kind: "blocked" };
  }
  return { kind: "ok", results };
}

async function searchDuckDuckGo(
  query: string,
  limit: number,
  timeRange?: TimeRange,
): Promise<Outcome> {
  let blocked = false;
  let lastError = "";

  for (let attempt = 0; attempt < DDG_MAX_ATTEMPTS; attempt++) {
    await acquireDdgSlot();
    if (attempt > 0) await sleep(1_500 * attempt);

    const result = await ddgAttempt(
      DDG_ATTEMPT_ORDER[attempt],
      query,
      timeRange,
    );
    if (result.kind === "ok") {
      return { ok: true, results: result.results.slice(0, limit) };
    }
    if (result.kind === "blocked") blocked = true;
    else lastError = result.error;
  }

  if (blocked) {
    // Make the next calls back off instead of hammering a flagged IP.
    ddgCooldownUntil = Date.now() + DDG_BLOCK_COOLDOWN_MS;
    return {
      ok: false,
      error:
        "DuckDuckGo blocked this request as automated traffic after several attempts.",
    };
  }
  return { ok: false, error: lastError || "DuckDuckGo search failed." };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

function formatResults(
  query: string,
  provider: ProviderName,
  results: SearchResult[],
  extras?: string[],
): string {
  const body = results
    .map((r) => {
      const lines = [`Title: ${r.title}`, `URL: ${r.url}`];
      if (r.date) lines.push(`Date: ${r.date}`);
      lines.push(`Snippet: ${r.snippet}`);
      return lines.join("\n");
    })
    .join("\n\n");
  const tail = extras?.length ? `\n\n${extras.join("\n\n")}` : "";
  return `Search results for '${query}':\n\n${body}${tail}\n\n(via ${
    PROVIDER_LABEL[provider]
  })`;
}

export default class WebSearchPlugin implements BeePlugin<WebSearchSchema> {
  name = "web_search";
  description =
    "Searches the web and returns a list of results, each with a title, URL, optional date and a short snippet. IMPORTANT: it does NOT return the full content of any page: to read a page, call a page-reading tool on its URL. Supports search operators: \"exact phrase\", site:domain.com (also site:reddit.com/r/name), and -excluded. Use time_range ('year', 'month'...) to restrict to recent pages instead of putting dates in the query. Make searches ONE AT A TIME, not in parallel: the search backend is rate limited and parallel bursts get blocked. If a search fails or is blocked, do not repeat the same query: rephrase it or use another site: operator. Prefer this tool over your own knowledge for anything that changes over time (news, prices, 'latest', 'current', any specific recent year) and for discovering what people say online; do NOT use it for timeless facts.";

  schema = searchSchema;
  returnDescription =
    "Returns a plain-text list of search results. Each result has Title, URL, optionally Date, and Snippet (a short excerpt). Some providers also add 'People also ask' and 'Related searches' lists that are useful to find new queries. Does NOT include the full content of any page.";

  configFields = [
    {
      key: "SERPER_API_KEY",
      label: "Serper API key (optional, Google results, recommended)",
      secret: true,
    },
    {
      key: "TAVILY_API_KEY",
      label: "Tavily API key (optional)",
      secret: true,
    },
    {
      key: "BRAVE_API_KEY",
      label: "Brave Search API key (optional)",
      secret: true,
    },
    {
      key: "SEARXNG_INSTANCE_URL",
      label: "SearXNG instance URL (optional)",
      secret: false,
    },
    {
      key: "SEARCH_PROVIDER",
      label:
        "Force a provider first: serper | tavily | brave | searxng | duckduckgo (optional, default auto)",
      secret: false,
    },
  ];

  selectionTests: SelectionTestCase<WebSearchSchema>[] = [
    {
      query: "who won the super bowl this year?",
      kind: "positive",
      shouldInvoke: true,
    },
    {
      query: "search for the latest news on the JavaScript ecosystem",
      kind: "positive",
      shouldInvoke: true,
    },
    {
      query: "what's the current price of bitcoin?",
      kind: "positive",
      shouldInvoke: true,
    },
    {
      query: "find reddit posts from the last year where people ask for an app to track invoices",
      kind: "positive",
      shouldInvoke: true,
    },
    {
      query: "read the contents of README.md",
      kind: "negative",
      shouldInvoke: false,
    },
    {
      query: "what's the capital of France?",
      kind: "negative",
      shouldInvoke: false,
    },
    {
      query: "list the files in my project folder",
      kind: "negative",
      shouldInvoke: false,
    },
    { query: "check this out", kind: "ambiguous" },
    {
      query: "what do you know about the Zig programming language?",
      kind: "ambiguous",
    },
    { query: "tell me more about that", kind: "ambiguous" },
  ];

  executionTests: ExecutionTestCase<WebSearchSchema>[] = [
    {
      description: "Search for a common term",
      kind: "happy",
      params: { query: "Deno runtime" },
      expect: (output: string) => output.startsWith("Search results for"),
    },
    {
      description: "Search with an explicit limit",
      kind: "happy",
      params: { query: "TypeScript 6.0 release notes", limit: 3 },
      expect: (output: string) => output.startsWith("Search results for"),
    },
    {
      description: "Search returns a well-formed result block",
      kind: "happy",
      params: { query: "Ecma International TC39" },
      expect: (output: string) =>
        output.includes("URL:") && output.includes("Snippet:"),
    },
    {
      description: "Search with a time_range filter",
      kind: "happy",
      params: { query: "deno release", time_range: "year" },
      expect: (output: string) => output.startsWith("Search results for"),
    },
    {
      description: "Search with a site: operator",
      kind: "happy",
      params: { query: 'site:news.ycombinator.com "Ask HN" tools' },
      expect: (output: string) => output.startsWith("Search results for"),
    },
    {
      description: "A query about 'anomaly' is not mistaken for a block page",
      kind: "edge",
      params: { query: "anomaly detection algorithms" },
      expect: (output: string) => output.startsWith("Search results for"),
    },
    {
      description: "Search query with only whitespace-adjacent punctuation",
      kind: "edge",
      params: { query: "??? !!!" },
      expect: (output: string) => output.length > 0,
    },
    {
      description: "Search with limit at the maximum boundary",
      kind: "edge",
      params: { query: "space exploration", limit: 10 },
      expect: (output: string) => output.startsWith("Search results for"),
    },
    {
      description: "Search with limit at the minimum boundary",
      kind: "edge",
      params: { query: "quantum computing", limit: 1 },
      expect: (output: string) => output.startsWith("Search results for"),
    },
    {
      description: "Search with an empty query fails schema validation",
      kind: "error",
      params: { query: "" },
      expect: (output: string) =>
        output.startsWith("The provided parameters are invalid"),
    },
    {
      description: "Search with limit above the maximum fails schema validation",
      kind: "error",
      params: { query: "test", limit: 999 },
      expect: (output: string) =>
        output.startsWith("The provided parameters are invalid"),
    },
    {
      description: "Invalid time_range fails schema validation",
      kind: "error",
      params: { query: "test", time_range: "decade" } as unknown as z.infer<
        WebSearchSchema
      >,
      expect: (output: string) =>
        output.startsWith("The provided parameters are invalid"),
    },
    {
      description: "Missing query field fails schema validation",
      kind: "error",
      params: {} as z.infer<WebSearchSchema>,
      expect: (output: string) =>
        output.startsWith("The provided parameters are invalid"),
    },
  ];

  private context?: BeeContext;

  initialize(context: BeeContext): void {
    this.context = context;
  }

  private async cfg(key: string): Promise<string | undefined> {
    const value = await this.context?.getConfig(key);
    const trimmed = typeof value === "string" ? value.trim() : "";
    return trimmed || undefined;
  }

  async process(input: z.infer<WebSearchSchema>): Promise<string> {
    const parsed = this.schema.safeParse(input);
    if (!parsed.success) {
      return `The provided parameters are invalid. Error: ${parsed.error.message}`;
    }

    const { query, limit = DEFAULT_SEARCH_LIMIT, time_range: timeRange } =
      parsed.data;

    const cacheKey = `${query.toLowerCase()}|${limit}|${timeRange ?? ""}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      this.context?.reportStep(`Search '${query}' served from cache`);
      return formatResults(query, cached.provider, cached.results, cached.extras);
    }

    const [serperKey, tavilyKey, braveKey, searxUrl, forcedRaw] = await Promise
      .all([
        this.cfg("SERPER_API_KEY"),
        this.cfg("TAVILY_API_KEY"),
        this.cfg("BRAVE_API_KEY"),
        this.cfg("SEARXNG_INSTANCE_URL"),
        this.cfg("SEARCH_PROVIDER"),
      ]);

    const available = new Set<ProviderName>(["duckduckgo"]);
    if (serperKey) available.add("serper");
    if (tavilyKey) available.add("tavily");
    if (braveKey) available.add("brave");
    if (searxUrl) available.add("searxng");

    const chain = AUTO_ORDER.filter((p) => available.has(p));
    const forced = forcedRaw?.toLowerCase() as ProviderName | undefined;
    if (forced && available.has(forced)) {
      chain.splice(chain.indexOf(forced), 1);
      chain.unshift(forced);
    }

    const run = (provider: ProviderName): Promise<Outcome> => {
      switch (provider) {
        case "serper":
          return searchSerper(serperKey!, query, limit, timeRange);
        case "tavily":
          return searchTavily(tavilyKey!, query, limit, timeRange);
        case "brave":
          return searchBrave(braveKey!, query, limit, timeRange);
        case "searxng":
          return searchSearxng(searxUrl!, query, limit, timeRange);
        case "duckduckgo":
          return searchDuckDuckGo(query, limit, timeRange);
      }
    };

    const failures: string[] = [];
    for (const provider of chain) {
      this.context?.reportStep(
        `Searching '${query}' via ${PROVIDER_LABEL[provider]}`,
      );
      const outcome = await run(provider);
      if (!outcome.ok) {
        failures.push(`- ${PROVIDER_LABEL[provider]}: ${outcome.error}`);
        continue;
      }

      const results = dedupeResults(outcome.results);
      if (results.length === 0) return `No results found for '${query}'.`;

      cacheSet(cacheKey, { provider, results, extras: outcome.extras });
      return formatResults(query, provider, results, outcome.extras);
    }

    return `Web search failed on every provider:\n${failures.join("\n")}\n\nThis is usually temporary rate limiting. Do not repeat the same query right away: rephrase it, try a different site: operator, or continue with the evidence already collected.`;
  }
}