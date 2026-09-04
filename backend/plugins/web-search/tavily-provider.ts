import type { SearchProvider, SearchResult } from "./provider.ts";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

interface TavilyResponse {
  results: TavilyResult[];
}

export class TavilyProvider implements SearchProvider {
  constructor(private readonly apiKey: string) {}

  async search(query: string, maxResults: number): Promise<SearchResult[]> {
    const response = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        query,
        max_results: maxResults,
        search_depth: "basic",
        chunks_per_source: 1,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Tavily API request failed with status ${response.status}: ${detail}`);
    }

    const data: TavilyResponse = await response.json();

    return data.results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
    }));
  }
}
