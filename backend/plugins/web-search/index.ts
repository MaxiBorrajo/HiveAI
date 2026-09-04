import { z } from "zod";
import type { BeeContext, BeePlugin } from "../../microkernel/bee-plugin.ts";
import type { SearchProvider } from "./provider.ts";
import { DuckDuckGoBlockedError, DuckDuckGoProvider } from "./duckduckgo-provider.ts";

const DEFAULT_MAX_RESULTS = 5;
const MAX_SNIPPET_CHARS = 200;

// Free, no-key search: this needs to work for end users of a packaged desktop
// app, who can't each go sign up for a Tavily/Brave API key. DuckDuckGo's
// no-JS HTML endpoint is scraped directly instead — no API key, but it can
// intermittently serve an anti-bot challenge regardless of retries (see
// duckduckgo-provider.ts for the details and prior art that hits the same
// wall). Delegating through SearchProvider (see provider.ts) keeps this
// swappable if a more reliable free option shows up later.

export default class WebSearchPlugin implements BeePlugin {
  name = "web_search";
  description =
    "Searches the web and returns a list of matching pages (title, URL, and a short snippet). Does not read the full content of any page — use web_read on one of the returned URLs for that.";

  schema = z.object({
    query: z.string().describe("The search query, as you would type it into a search engine."),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(25)
      .default(DEFAULT_MAX_RESULTS)
      .describe("Maximum number of results to return."),
  }) as any;

  private context!: BeeContext;

  initialize(context: BeeContext): void {
    this.context = context;
  }

  private buildProvider(): SearchProvider {
    return new DuckDuckGoProvider((attempt, challenged) => {
      this.context.reportStep(
        challenged
          ? `Intento ${attempt + 1}: DuckDuckGo devolvió un desafío anti-bot, reintentando...`
          : `Intento ${attempt + 1}: resultados obtenidos correctamente`,
      );
    });
  }

  async process(input: unknown): Promise<string> {
    const parsed = this.schema.safeParse(input);
    if (!parsed.success) {
      return `The provided parameters are invalid. Error: ${parsed.error.message}`;
    }

    const { query, maxResults } = parsed.data as { query: string; maxResults: number };

    try {
      const results = await this.buildProvider().search(query, maxResults);

      if (results.length === 0) {
        return `No results found for '${query}'.`;
      }

      const list = results
        .map((r, i) => {
          const snippet = r.snippet.length > MAX_SNIPPET_CHARS
            ? `${r.snippet.slice(0, MAX_SNIPPET_CHARS)}...`
            : r.snippet;
          return `${i + 1}. ${r.title}\n   ${r.url}${snippet ? `\n   ${snippet}` : ""}`;
        })
        .join("\n\n");

      return `Found ${results.length} result(s) for '${query}':\n\n${list}`;
    } catch (error) {
      if (error instanceof DuckDuckGoBlockedError) {
        return `Web search is temporarily unavailable: DuckDuckGo is blocking automated requests from this network right now (anti-bot challenge). This is not a bug — it happens intermittently and usually clears up on its own after a while. Tell the user their search couldn't go through right now and suggest trying again shortly, or searching manually.`;
      }
      const detail = error instanceof Error ? error.message : String(error);
      return `An error occurred while searching: ${detail}`;
    }
  }
}
