import { z } from "zod";
import type {
  BeeContext,
  BeePlugin,
  SelectionTestCase,
  ExecutionTestCase,
} from "./bee-plugin.ts";

const FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_SEARCH_LIMIT = 5;
const MAX_SEARCH_LIMIT = 10;
const SEARXNG_INSTANCE_URL = Deno.env.get("SEARXNG_INSTANCE_URL");

const MAX_SEARCH_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 800;
const JITTER_MAX_MS = 400;

const DDG_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
];

const searchSchema = z.object({
  query: z.string().min(1).describe("The search query to look up on the web."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_SEARCH_LIMIT)
    .optional()
    .describe(
      `Maximum number of results to return (default ${DEFAULT_SEARCH_LIMIT}, max ${MAX_SEARCH_LIMIT}).`,
    ),
});

type WebSearchSchema = typeof searchSchema;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface SearxResult {
  title: string;
  url: string;
  content?: string;
}

interface SearxResponse {
  results?: SearxResult[];
}

async function fetchWithTimeout(
  url: string,
  ms: number,
  headers: Record<string, string> = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal, headers });
  } finally {
    clearTimeout(timer);
  }
}

function decodeEntities(text: string): string {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&nbsp;": " ",
  };
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, (m) => entities[m] ?? m);
}

function extractAnchorsByClass(
  html: string,
  className: string,
): Array<{ href: string; text: string }> {
  const anchors: Array<{ href: string; text: string }> = [];
  const regex = new RegExp(
    `<a[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*href="([^"]*)"[^>]*>([\\s\\S]*?)<\\/a>`,
    "g",
  );
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    anchors.push({
      href: match[1],
      text: decodeEntities(match[2].replace(/<[^>]+>/g, "")).trim(),
    });
  }
  return anchors;
}

function resolveDdgUrl(rawUrl: string): string {
  const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
  return uddgMatch ? decodeURIComponent(uddgMatch[1]) : rawUrl;
}

function parseDuckDuckGoResults(html: string): SearchResult[] {
  const titles = extractAnchorsByClass(html, "result__a");
  const snippets = extractAnchorsByClass(html, "result__snippet");

  return titles.map((t, i) => ({
    title: t.text,
    url: resolveDdgUrl(t.href),
    snippet: snippets[i]?.text ?? "",
  }));
}

function pickRandomUserAgent(): string {
  return DDG_USER_AGENTS[Math.floor(Math.random() * DDG_USER_AGENTS.length)];
}

function buildDdgBrowserHeaders(userAgent: string): Record<string, string> {
  return {
    "User-Agent": userAgent,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Referer: "https://duckduckgo.com/",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Upgrade-Insecure-Requests": "1",
    DNT: "1",
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isDdgBlockedResponse(html: string): boolean {
  return html.includes("anomaly") || html.includes("unusual traffic");
}

async function searchDuckDuckGo(
  query: string,
  limit: number,
): Promise<SearchResult[] | string> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  for (let attempt = 1; attempt <= MAX_SEARCH_RETRIES; attempt++) {
    if (attempt > 1) {
      const backoff = RETRY_BASE_DELAY_MS * 2 ** (attempt - 2);
      await sleep(backoff + Math.random() * JITTER_MAX_MS);
    } else {
      await sleep(Math.random() * JITTER_MAX_MS);
    }

    const headers = buildDdgBrowserHeaders(pickRandomUserAgent());

    let response: Response;
    try {
      response = await fetchWithTimeout(url, FETCH_TIMEOUT_MS, headers);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        if (attempt === MAX_SEARCH_RETRIES) {
          return `Search request timed out after ${FETCH_TIMEOUT_MS}ms.`;
        }
        continue;
      }
      const detail = error instanceof Error ? error.message : String(error);
      if (attempt === MAX_SEARCH_RETRIES) {
        return `An error occurred during web search: ${detail}`;
      }
      continue;
    }

    if (response.status === 429 || response.status === 403) {
      if (attempt === MAX_SEARCH_RETRIES) {
        return "DuckDuckGo blocked this request as automated traffic after multiple retries. Try again later or switch to a SearXNG instance.";
      }
      continue;
    }

    if (!response.ok) {
      return `Failed to search. Status: ${response.status} ${response.statusText}`;
    }

    const html = await response.text();

    if (isDdgBlockedResponse(html)) {
      if (attempt === MAX_SEARCH_RETRIES) {
        return "DuckDuckGo blocked this request as automated traffic after multiple retries. Try again later or switch to a SearXNG instance.";
      }
      continue;
    }

    return parseDuckDuckGoResults(html).slice(0, limit);
  }

  return "DuckDuckGo blocked this request as automated traffic after multiple retries. Try again later or switch to a SearXNG instance.";
}

async function searchSearxng(
  instanceUrl: string,
  query: string,
  limit: number,
): Promise<SearchResult[] | string> {
  const url = `${instanceUrl.replace(/\/$/, "")}/search?q=${encodeURIComponent(query)}&format=json&categories=general`;

  let response: Response;
  try {
    response = await fetchWithTimeout(url, FETCH_TIMEOUT_MS, {
      Accept: "application/json",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return `Search request timed out after ${FETCH_TIMEOUT_MS}ms.`;
    }
    const detail = error instanceof Error ? error.message : String(error);
    return `An error occurred during web search: ${detail}`;
  }

  if (!response.ok) {
    return `Failed to search. Status: ${response.status} ${response.statusText}`;
  }

  let data: SearxResponse;
  try {
    data = await response.json();
  } catch {
    return "SearXNG instance did not return valid JSON. Check that 'json' is enabled in its settings.yml under search.formats.";
  }

  const results = (data.results ?? [])
    .slice(0, limit)
    .map((r) => ({ title: r.title, url: r.url, snippet: r.content ?? "" }));

  return results;
}

export default class WebSearchPlugin implements BeePlugin<WebSearchSchema> {
  name = "web_search";
  description =
    "Searches the web for real-time information. Prefer this tool over your own knowledge when the request is about something that changes over time — even if you believe you already know the answer, since your training data may be outdated. Time markers like 'this year', 'currently', 'latest', 'now', 'today', or any specific year mentioned in the request ALWAYS mean you should search, regardless of how stable or well-known the general topic seems (e.g. 'who won the super bowl THIS YEAR' needs a search even though Super Bowl winners are usually well-documented facts, because 'this year' points to a specific, possibly recent result you may not have). Do NOT search for genuinely timeless questions with no time marker (what a language/concept/technology is, how something works, historical facts from a specific past date). USE CASES: Use the 'search' action for queries requiring up-to-date knowledge, recent news, trivia with time markers, or documentation lookups (e.g., 'who won the game this year', 'latest React docs').";

  schema = searchSchema;

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
    {
      query: "check this out",
      kind: "ambiguous",
    },
    {
      query: "what do you know about the Zig programming language?",
      kind: "ambiguous",
    },
    {
      query: "tell me more about that",
      kind: "ambiguous",
    },
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
      description:
        "Search with limit above the maximum fails schema validation",
      kind: "error",
      params: { query: "test", limit: 999 },
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

  async process(input: z.infer<WebSearchSchema>): Promise<string> {
    const parsed = this.schema.safeParse(input);
    if (!parsed.success) {
      return `The provided parameters are invalid. Error: ${parsed.error.message}`;
    }

    const { query, limit = DEFAULT_SEARCH_LIMIT } = parsed.data;

    let outcome: SearchResult[] | string;
    if (SEARXNG_INSTANCE_URL) {
      this.context?.reportStep(`Searching '${query}' via SearXNG`);
      outcome = await searchSearxng(SEARXNG_INSTANCE_URL, query, limit);
    } else {
      this.context?.reportStep(`Searching '${query}' via DuckDuckGo`);
      outcome = await searchDuckDuckGo(query, limit);
    }

    if (typeof outcome === "string") return outcome;
    if (outcome.length === 0) return `No results found for '${query}'.`;

    return `Search results for '${query}':\n\n${outcome
      .map((r) => `Title: ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}`)
      .join("\n\n")}`;
  }
}
