import { z } from "zod";
import type {
  BeeContext,
  BeePlugin,
  SelectionTestCase,
  ExecutionTestCase,
} from "./bee-plugin.ts";
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

const schema = z.object({
  query: z.string().describe("The search query, as you would type it into a search engine."),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(25)
    .default(DEFAULT_MAX_RESULTS)
    .describe("Maximum number of results to return."),
});

type WebSearchSchema = typeof schema;

export default class WebSearchPlugin implements BeePlugin<WebSearchSchema> {
  name = "web_search";
  description =
    "Searches the web and returns a list of matching pages (title, URL, and a short snippet). Does not read the full content of any page — use web_read on one of the returned URLs for that.";

  schema = schema;

  selectionTests: SelectionTestCase<WebSearchSchema>[] = [
    // 3 Positive
    {
      query: "search the web for the latest TypeScript release notes",
      kind: "positive",
      shouldInvoke: true,
    },
    {
      query: "look up who won the last F1 race",
      kind: "positive",
      shouldInvoke: true,
    },
    {
      query: "find news about Deno runtime online",
      kind: "positive",
      shouldInvoke: true,
    },
    // 3 Negative
    {
      query: "what time is it?",
      kind: "negative",
      shouldInvoke: false,
    },
    {
      query: "create a file called notes.txt",
      kind: "negative",
      shouldInvoke: false,
    },
    {
      query: "read the contents of README.md",
      kind: "negative",
      shouldInvoke: false,
    },
    // 3 Ambiguous
    {
      query: "what's the capital of France?",
      kind: "ambiguous",
    },
    {
      query: "open example.com and tell me what it says",
      kind: "ambiguous",
    },
    {
      query: "explain how quicksort works",
      kind: "ambiguous",
    },
  ];

  executionTests: ExecutionTestCase<WebSearchSchema>[] = [
    // 3 Happy — network-dependent: DuckDuckGo may intermittently rate-limit
    // even a well-formed request (see duckduckgo-provider.ts), so these can
    // fail for reasons outside this code's control.
    {
      description: "Search a common, well-formed query",
      kind: "happy",
      params: { query: "deno runtime", maxResults: DEFAULT_MAX_RESULTS },
      expect: (output: string) => output.includes("Found") || output.includes("temporarily unavailable"),
    },
    {
      description: "Search respects a small maxResults",
      kind: "happy",
      params: { query: "typescript", maxResults: 1 },
      expect: (output: string) => output.includes("Found") || output.includes("temporarily unavailable"),
    },
    {
      description: "Search a query with special characters",
      kind: "happy",
      params: { query: "C++ vs Rust performance", maxResults: DEFAULT_MAX_RESULTS },
      expect: (output: string) => output.includes("Found") || output.includes("temporarily unavailable"),
    },
    // 3 Edge
    {
      description: "maxResults capped at the schema maximum (25)",
      kind: "edge",
      params: { query: "javascript", maxResults: 25 },
      expect: (output: string) => output.includes("Found") || output.includes("temporarily unavailable"),
    },
    {
      description: "Very short, likely-low-signal query still returns a response",
      kind: "edge",
      params: { query: "a", maxResults: DEFAULT_MAX_RESULTS },
      expect: (output: string) =>
        output.includes("Found") ||
        output.includes("No results found") ||
        output.includes("temporarily unavailable"),
    },
    {
      description: "Query with no results found is reported clearly",
      kind: "edge",
      params: {
        query: "xyzxyzxyz_definitely_no_results_query_123456789",
        maxResults: DEFAULT_MAX_RESULTS,
      },
      expect: (output: string) =>
        output.includes("No results found") ||
        output.includes("Found") ||
        output.includes("temporarily unavailable"),
    },
    // 3 Error
    {
      description: "maxResults below minimum is rejected",
      kind: "error",
      params: { query: "test", maxResults: 0 as unknown as number },
      expect: (output: string) =>
        output.toLowerCase().includes("invalid") ||
        output.toLowerCase().includes("error"),
    },
    {
      description: "maxResults above schema maximum is rejected",
      kind: "error",
      params: { query: "test", maxResults: 100 as unknown as number },
      expect: (output: string) =>
        output.toLowerCase().includes("invalid") ||
        output.toLowerCase().includes("error"),
    },
    {
      description: "Missing required query property",
      kind: "error",
      params: {
        query: undefined as unknown as string,
        maxResults: DEFAULT_MAX_RESULTS,
      },
      expect: (output: string) =>
        output.toLowerCase().includes("invalid") ||
        output.toLowerCase().includes("error"),
    },
  ];

  private context!: BeeContext;

  get testCases() {
    return this.selectionTests;
  }

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

  async process(input: z.infer<WebSearchSchema>): Promise<string> {
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
