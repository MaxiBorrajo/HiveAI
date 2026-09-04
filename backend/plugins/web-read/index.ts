import { z } from "zod";
import type {
  BeeContext,
  BeePlugin,
  SelectionTestCase,
  ExecutionTestCase,
} from "./bee-plugin.ts";

const MAX_CONTENT_CHARS = 20_000;
const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Fetches a URL and extracts readable text from its HTML, so the model can read
// pages found via web_search without a headless browser. This is a best-effort
// text extraction (strip scripts/styles/tags), not a full readability/article
// parser, so pages heavy on JS-rendered content may come back mostly empty.

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function extractText(html: string): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  const withBreaks = withoutNoise.replace(
    /<\/(p|div|br|li|h[1-6]|tr)>/gi,
    "\n",
  );

  const text = decodeEntities(withBreaks.replace(/<[^>]+>/g, " "));

  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

const schema = z.object({
  url: z.string().describe("The absolute URL of the page to fetch and read."),
});

type WebReadSchema = typeof schema;

export default class WebReadPlugin implements BeePlugin<WebReadSchema> {
  name = "web_read";
  description =
    "Fetches a URL and returns the readable text content of that page. Use it to read a page found via web_search. Does not execute JavaScript, so content that only appears after client-side rendering may not be included.";

  schema = schema;

  selectionTests: SelectionTestCase<WebReadSchema>[] = [
    // 3 Positive
    {
      query: "read the content at https://example.com",
      kind: "positive",
      shouldInvoke: true,
    },
    {
      query: "open this article and summarize it: https://blog.example.com/post",
      kind: "positive",
      shouldInvoke: true,
    },
    {
      query: "fetch the text of https://docs.example.com/guide",
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
      query: "search the web for TypeScript tutorials",
      kind: "negative",
      shouldInvoke: false,
    },
    {
      query: "create a file called notes.txt",
      kind: "negative",
      shouldInvoke: false,
    },
    // 3 Ambiguous
    {
      query: "what does example.com say about pricing?",
      kind: "ambiguous",
    },
    {
      query: "check if this site is online",
      kind: "ambiguous",
    },
    {
      query: "download this page",
      kind: "ambiguous",
    },
  ];

  executionTests: ExecutionTestCase<WebReadSchema>[] = [
    // 3 Happy
    {
      description: "Fetch a well-known, always-available page",
      kind: "happy",
      params: { url: "https://example.com" },
      expect: (output: string) => output.length > 0,
    },
    {
      description: "Fetch returns readable text, not raw HTML tags",
      kind: "happy",
      params: { url: "https://example.com" },
      expect: (output: string) => !output.includes("<html"),
    },
    {
      description: "Fetch a second well-known page",
      kind: "happy",
      params: { url: "https://www.iana.org/help/example-domains" },
      expect: (output: string) => output.length > 0,
    },
    // 3 Edge
    {
      description: "http (non-https) URL is accepted",
      kind: "edge",
      params: { url: "http://example.com" },
      expect: (output: string) => output.length > 0,
    },
    {
      description: "URL with query params is accepted",
      kind: "edge",
      params: { url: "https://example.com/?ref=test" },
      expect: (output: string) => output.length > 0,
    },
    {
      description: "Non-html content-type is rejected clearly",
      kind: "edge",
      params: { url: "https://www.iana.org/favicon.ico" },
      expect: (output: string) =>
        output.includes("does not appear to be a text/HTML page"),
    },
    // 3 Error
    {
      description: "Malformed URL fails clearly",
      kind: "error",
      params: { url: "not-a-valid-url" },
      expect: (output: string) => output.includes("not a valid absolute URL"),
    },
    {
      description: "Non-http(s) protocol is rejected",
      kind: "error",
      params: { url: "ftp://example.com/file" },
      expect: (output: string) => output.includes("only http/https URLs are supported"),
    },
    {
      description: "Missing required url property",
      kind: "error",
      params: { url: undefined as unknown as string },
      expect: (output: string) =>
        output.toLowerCase().includes("invalid") ||
        output.toLowerCase().includes("error"),
    },
  ];

  get testCases() {
    return this.selectionTests;
  }

  initialize(_context: BeeContext): void {}

  async process(input: z.infer<WebReadSchema>): Promise<string> {
    const parsed = this.schema.safeParse(input);
    if (!parsed.success) {
      return `The provided parameters are invalid. Error: ${parsed.error.message}`;
    }

    const { url } = parsed.data as { url: string };

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return `Error: '${url}' is not a valid absolute URL.`;
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return `Error: only http/https URLs are supported.`;
    }

    console.log(`[web-read] 🐝 Fetching '${url}'`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: controller.signal,
      });

      if (!response.ok) {
        return `The request to '${url}' failed with status ${response.status}.`;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("html") && !contentType.includes("text")) {
        return `Error: '${url}' does not appear to be a text/HTML page (content-type: ${contentType || "unknown"}).`;
      }

      const html = await response.text();
      let text = extractText(html);

      if (!text) {
        return `The page at '${url}' produced no readable text (it may rely on JavaScript to render content).`;
      }

      if (text.length > MAX_CONTENT_CHARS) {
        text = `${text.slice(0, MAX_CONTENT_CHARS)}\n...(truncated)`;
      }

      return text;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return `The request to '${url}' timed out after ${FETCH_TIMEOUT_MS / 1000}s.`;
      }
      const detail = error instanceof Error ? error.message : String(error);
      return `An error occurred while fetching '${url}': ${detail}`;
    } finally {
      clearTimeout(timeout);
    }
  }
}
