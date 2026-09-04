// Abstraction over "who actually performs the web search". The plugin (index.ts)
// only depends on this interface, not on any specific provider — swapping Tavily
// for a self-hosted SearXNG instance (or anything else) later means adding a new
// file here and changing one line in index.ts, nothing else.

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchProvider {
  search(query: string, maxResults: number): Promise<SearchResult[]>;
}
