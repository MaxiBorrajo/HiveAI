import { z } from "zod";
import { JSDOM } from "npm:jsdom@25";
import { Readability } from "npm:@mozilla/readability@0.5";
import TurndownService from "npm:turndown@7.2";
import type {
  BeeContext,
  BeePlugin,
  SelectionTestCase,
  ExecutionTestCase,
} from "./bee-plugin.ts";

const FETCH_TIMEOUT_MS = 10_000;
const JINA_TIMEOUT_MS = 15_000;
const MAX_CONTENT_CHARS = 20_000;
const MIN_ACCEPTABLE_CONTENT_CHARS = 200;
const READ_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});
turndown.remove(["script", "style", "noscript", "iframe"]);

const readSchema = z.object({
  url: z
    .string()
    .url()
    .describe("The URL of the webpage to read and extract text from."),
});

type WebReadSchema = typeof readSchema;

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "0.0.0.0" || h.endsWith(".local")) return true;

  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;

  const [a, b] = ipv4.slice(1).map(Number);
  if ([a, b].some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;

  return (
    a === 127 ||
    a === 10 ||
    a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function validateUrl(
  rawUrl: string,
): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: `'${rawUrl}' is not a valid URL.` };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      reason: `Protocol '${url.protocol}' is not allowed. Only http/https are permitted.`,
    };
  }

  if (isBlockedHost(url.hostname)) {
    return {
      ok: false,
      reason: `Host '${url.hostname}' resolves to a private or local address and cannot be fetched.`,
    };
  }

  return { ok: true, url };
}

async function fetchWithTimeout(
  url: string,
  ms: number,
  headers: Record<string, string> = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers,
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

function isPdfUrl(url: string): boolean {
  return /\.pdf(\?|#|$)/i.test(url);
}

function truncate(content: string): string {
  if (content.length <= MAX_CONTENT_CHARS) return content;
  return `${content.slice(0, MAX_CONTENT_CHARS)}\n...(truncated)`;
}

async function extractWithReadability(
  url: string,
): Promise<{ content: string; title?: string } | null> {
  let response: Response;
  try {
    response = await fetchWithTimeout(url, FETCH_TIMEOUT_MS, {
      "User-Agent": READ_USER_AGENT,
      Accept: "text/html,*/*",
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !contentType.includes("text/html")) return null;

  const html = await response.text();

  let dom: JSDOM;
  try {
    dom = new JSDOM(html, { url });
  } catch {
    return null;
  }

  const article = new Readability(dom.window.document).parse();
  if (!article?.content) return null;

  const markdown = turndown.turndown(article.content).trim();
  if (markdown.length < MIN_ACCEPTABLE_CONTENT_CHARS) return null;

  return { content: markdown, title: article.title ?? undefined };
}

async function extractWithJina(url: string): Promise<string | null> {
  const jinaUrl = `https://r.jina.ai/${url}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(jinaUrl, JINA_TIMEOUT_MS, {
      Accept: "text/plain",
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const text = (await response.text()).trim();
  return text.length >= MIN_ACCEPTABLE_CONTENT_CHARS ? text : null;
}

export default class WebReadPlugin implements BeePlugin<WebReadSchema> {
  name = "web_read";
  description =
    "Extracts and reads the text content from a specific URL or webpage. Use this tool when the user provides a specific link and asks you to summarize, translate, or analyze the content of that webpage. Do NOT use this tool to search the web (it cannot search, it only reads exact URLs).";

  schema = readSchema;

  selectionTests: SelectionTestCase<WebReadSchema>[] = [
    {
      query: "summarize this article: https://example.com/article",
      kind: "positive",
      shouldInvoke: true,
      expectedParams: { url: "https://example.com/article" },
    },
    {
      query:
        "read this and tell me what it says: https://news.example.com/story",
      kind: "positive",
      shouldInvoke: true,
      expectedParams: { url: "https://news.example.com/story" },
    },
    {
      query: "translate this page to spanish: https://docs.example.com/guide",
      kind: "positive",
      shouldInvoke: true,
      expectedParams: { url: "https://docs.example.com/guide" },
    },
    {
      query: "what's the capital of France?",
      kind: "negative",
      shouldInvoke: false,
    },
    {
      query: "read the contents of README.md",
      kind: "negative",
      shouldInvoke: false,
    },
    {
      query: "search for the latest news on the JavaScript ecosystem",
      kind: "negative",
      shouldInvoke: false,
    },
    {
      query: "check this out",
      kind: "ambiguous",
    },
    {
      query: "tell me more about that",
      kind: "ambiguous",
    },
    {
      query: "what do you know about the Zig programming language?",
      kind: "ambiguous",
    },
  ];

  executionTests: ExecutionTestCase<WebReadSchema>[] = [
    {
      description: "Read a simple webpage",
      kind: "happy",
      params: { url: "https://example.com" },
      expect: (output: string) =>
        output.toLowerCase().includes("example domain"),
    },
    {
      description: "Read a webpage with a title and article content",
      kind: "happy",
      params: { url: "https://example.com/article" },
      expect: (output: string) => output.length > 0,
    },
    {
      description: "Read a PDF via Jina fallback",
      kind: "happy",
      params: {
        url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
      },
      expect: (output: string) => output.length > 0,
    },
    {
      description: "Read a URL with no path, just a domain",
      kind: "edge",
      params: { url: "https://example.com/" },
      expect: (output: string) => output.length > 0,
    },
    {
      description: "Blocks a request to a private/local address (SSRF)",
      kind: "edge",
      params: { url: "http://127.0.0.1:37545/admin" },
      expect: (output: string) => output.includes("private or local address"),
    },
    {
      description: "Blocks a non-http(s) protocol",
      kind: "edge",
      params: { url: "file:///etc/passwd" },
      expect: (output: string) => output.includes("is not allowed"),
    },
    {
      description: "Read an unreachable URL",
      kind: "error",
      params: { url: "https://this-domain-does-not-exist-xyz123.invalid" },
      expect: (output: string) => output.startsWith("Failed"),
    },
    {
      description: "Read a malformed URL fails schema validation",
      kind: "error",
      params: { url: "not-a-real-url" } as z.infer<WebReadSchema>,
      expect: (output: string) =>
        output.startsWith("The provided parameters are invalid"),
    },
    {
      description: "Missing url field fails schema validation",
      kind: "error",
      params: {} as z.infer<WebReadSchema>,
      expect: (output: string) =>
        output.startsWith("The provided parameters are invalid"),
    },
  ];
  private context?: BeeContext;

  initialize(context: BeeContext): void {
    this.context = context;
  }

  async process(input: z.infer<WebReadSchema>): Promise<string> {
    const parsed = this.schema.safeParse(input);
    if (!parsed.success) {
      return `The provided parameters are invalid. Error: ${parsed.error.message}`;
    }

    const { url } = parsed.data;

    const check = validateUrl(url);
    if (!check.ok) {
      return `Cannot fetch '${url}': ${check.reason}`;
    }

    if (isPdfUrl(url)) {
      this.context?.reportStep("Extracting PDF via Jina");
      const jinaResult = await extractWithJina(url);
      if (jinaResult) return truncate(jinaResult);
      return `Failed to extract content from PDF '${url}'.`;
    }

    this.context?.reportStep("Extracting content with Readability");
    const readabilityResult = await extractWithReadability(url);
    if (readabilityResult) {
      const header = readabilityResult.title
        ? `# ${readabilityResult.title}\n\n`
        : "";
      return truncate(`${header}${readabilityResult.content}`);
    }

    this.context?.reportStep("Falling back to Jina Reader");
    const jinaResult = await extractWithJina(url);
    if (jinaResult) return truncate(jinaResult);

    return `Failed to extract readable content from '${url}'. The page may require JavaScript, be behind a paywall, or block automated access.`;
  }
}
