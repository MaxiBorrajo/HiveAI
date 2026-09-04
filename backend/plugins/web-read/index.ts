import { z } from "zod";
import type { BeeContext, BeePlugin } from "../../microkernel/bee-plugin.ts";

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

export default class WebReadPlugin implements BeePlugin {
  name = "web_read";
  description =
    "Fetches a URL and returns the readable text content of that page. Use it to read a page found via web_search. Does not execute JavaScript, so content that only appears after client-side rendering may not be included.";

  schema = z.object({
    url: z.string().describe("The absolute URL of the page to fetch and read."),
  }) as any;

  initialize(_context: BeeContext): void {}

  async process(input: unknown): Promise<string> {
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
