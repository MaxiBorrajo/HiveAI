import type { SearchProvider, SearchResult } from "./provider.ts";

const SEARCH_URL = "https://html.duckduckgo.com/html/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const RETRY_DELAY_MS = 4000;
const MAX_RETRIES = 2;

// Scrapes DuckDuckGo's no-JS HTML results page directly — no API key, no
// per-user signup, which matters for a desktop app with real end users (they
// can't each go get a Tavily key). The tradeoff, confirmed by hand: DuckDuckGo
// serves an anti-bot challenge ("cc=botnet", CAPTCHA form) unpredictably, even
// with a browser-like User-Agent/Referer and seconds between requests — same
// endpoint used by duck-duck-scrape (npm) and LM Studio's DuckDuckGo plugin,
// both of which hit the same wall (see their open issues about "Failed to get
// VQD"). Retrying a couple times with a delay recovers some of these, but a
// run of consecutive challenges is expected behavior, not a bug — surface it
// to the caller as a distinct error so the plugin can say what actually
// happened instead of claiming "no results".

export class DuckDuckGoBlockedError extends Error {
  constructor(query: string) {
    super(
      `DuckDuckGo blocked the search for '${query}' with an anti-bot challenge after ${MAX_RETRIES + 1} attempts.`,
    );
    this.name = "DuckDuckGoBlockedError";
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).trim();
}

function unwrapRedirect(href: string): string {
  const match = href.match(/[?&]uddg=([^&]+)/);
  if (!match) return href;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return href;
  }
}

function parseResults(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];
  const blocks = html.split(/<div class="result results_links/).slice(1);

  for (const chunk of blocks) {
    if (results.length >= maxResults) break;

    const linkMatch = chunk.match(
      /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/,
    );
    if (!linkMatch) continue;

    const url = unwrapRedirect(decodeEntities(linkMatch[1]));
    const title = stripTags(linkMatch[2]);

    const snippetMatch = chunk.match(
      /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/,
    );
    const snippet = snippetMatch ? stripTags(snippetMatch[1]) : "";

    if (title && url) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

export class DuckDuckGoProvider implements SearchProvider {
  constructor(private readonly onAttempt?: (attempt: number, challenged: boolean) => void) {}

  async search(query: string, maxResults: number): Promise<SearchResult[]> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const response = await fetch(SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
          Referer: "https://html.duckduckgo.com/",
        },
        body: new URLSearchParams({ q: query, kl: "wt-wt", b: "" }),
      });

      if (!response.ok) {
        throw new Error(`DuckDuckGo request failed with status ${response.status}.`);
      }

      const html = await response.text();
      const challenged = html.includes('id="challenge-form"');
      this.onAttempt?.(attempt, challenged);

      if (!challenged) {
        return parseResults(html, maxResults);
      }

      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }

    throw new DuckDuckGoBlockedError(query);
  }
}
