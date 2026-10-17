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
const MAX_FETCH_RETRIES = 2;
const RETRY_BACKOFF_MS = 500;
const MAX_RETRY_AFTER_S = 3;
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
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Character offset to start reading from. Use the offset given in a previous '[Showing chars ...]' note to continue a long page. Defaults to 0.",
    ),
});

type WebReadSchema = typeof readSchema;

function isPrivateIPv4(a: number, b: number): boolean {
  return (
    a === 127 ||
    a === 10 ||
    a === 0 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function isBlockedIp(ip: string): boolean {
  const ipv4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    if ([a, b].some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    return isPrivateIPv4(a, b);
  }

  if (ip.includes(":")) {
    const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]);
    return (
      v6 === "::" ||
      v6 === "::1" ||
      /^f[cd][0-9a-f]{2}:/.test(v6) ||
      /^fe[89ab][0-9a-f]:/.test(v6) ||
      /^::ffff:[0-9a-f]+:[0-9a-f]+$/.test(v6)
    );
  }

  return false;
}

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "0.0.0.0" || h.endsWith(".local")) return true;
  return isBlockedIp(h);
}

async function resolvesToPrivateAddress(hostname: string): Promise<boolean> {
  if (isBlockedHost(hostname)) return true;
  if (/^[\d.]+$/.test(hostname) || hostname.includes(":")) return false;
  for (const recordType of ["A", "AAAA"] as const) {
    try {
      const addresses = await Deno.resolveDns(hostname, recordType);
      if (addresses.some(isBlockedIp)) return true;
    } catch {
    }
  }
  return false;
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

const MAX_REDIRECTS = 5;

async function fetchWithTimeout(
  url: string,
  ms: number,
  headers: Record<string, string> = {},
  trusted = false,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!trusted) {
        const check = validateUrl(current);
        if (!check.ok) throw new Error(check.reason);
        if (await resolvesToPrivateAddress(check.url.hostname)) {
          throw new Error(
            `Host '${check.url.hostname}' resolves to a private or local address and cannot be fetched.`,
          );
        }
      }
      const response = await fetch(current, {
        signal: controller.signal,
        headers,
        redirect: "manual",
      });
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location) {
        return response;
      }
      await response.body?.cancel();
      current = new URL(location, current).toString();
    }
    throw new Error("Too many redirects.");
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  ms: number,
  headers: Record<string, string> = {},
): Promise<Response | null> {
  for (let attempt = 0; attempt <= MAX_FETCH_RETRIES; attempt++) {
    try {
      const response = await fetchWithTimeout(url, ms, headers);
      const retryable = response.status >= 500 || response.status === 429;
      if (response.ok || !retryable || attempt === MAX_FETCH_RETRIES) {
        return response;
      }
      const retryAfter = Number(response.headers.get("retry-after"));
      await response.body?.cancel();
      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        await sleep(Math.min(retryAfter, MAX_RETRY_AFTER_S) * 1000);
        continue;
      }
    } catch {
      if (attempt === MAX_FETCH_RETRIES) return null;
    }
    await sleep(RETRY_BACKOFF_MS * (attempt + 1));
  }
  return null;
}

function isPdfUrl(url: string): boolean {
  return /\.pdf(\?|#|$)/i.test(url);
}

type Extraction =
  | { ok: true; content: string; title?: string }
  | { ok: false; reason: string; permanent?: boolean };

const NOISE_SELECTORS = "nav, header, footer, aside, form, [role=navigation], [role=banner], [role=contentinfo], [aria-label*=cookie i], [id*=cookie i], [class*=cookie i]";

function statusReason(status: number): Extraction & { ok: false } {
  if (status === 404 || status === 410) {
    return {
      ok: false,
      permanent: true,
      reason: `HTTP ${status}: the page no longer exists. Do not retry; use another source.`,
    };
  }
  if (status === 401 || status === 403 || status === 429) {
    return {
      ok: false,
      reason: `HTTP ${status}: the site blocks or rate-limits automated access. Try a different source.`,
    };
  }
  return { ok: false, reason: `HTTP ${status} error.` };
}

function toReadableUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    if (u.hostname === "reddit.com" || u.hostname === "www.reddit.com") {
      u.hostname = "old.reddit.com";
      return u.toString();
    }
  } catch {
    // keep original
  }
  return rawUrl;
}

function paginate(content: string, offset: number): string {
  const total = content.length;
  if (offset >= total) {
    return `[Offset ${offset} is beyond the end of the page (${total} chars).]`;
  }
  const end = Math.min(offset + MAX_CONTENT_CHARS, total);
  const chunk = content.slice(offset, end);
  if (end >= total) return chunk;
  return `${chunk}\n\n[Showing chars ${offset}-${end} of ${total}. Call again with offset=${end} to continue.]`;
}

function htmlToMarkdown(html: string, url: string): Extraction {
  let dom: JSDOM;
  try {
    dom = new JSDOM(html, { url });
  } catch {
    return { ok: false, reason: "The page HTML could not be parsed." };
  }

  const doc = dom.window.document;
  doc
    .querySelectorAll(NOISE_SELECTORS)
    .forEach((el: { remove(): void }) => el.remove());
  const cleanedBodyHtml = doc.body?.innerHTML ?? "";

  const article = new Readability(doc).parse();
  if (article?.content) {
    const markdown = turndown.turndown(article.content).trim();
    if (markdown.length >= MIN_ACCEPTABLE_CONTENT_CHARS) {
      return { ok: true, content: markdown, title: article.title ?? undefined };
    }
  }

  const body = cleanedBodyHtml ? turndown.turndown(cleanedBodyHtml).trim() : "";
  if (body.length >= MIN_ACCEPTABLE_CONTENT_CHARS) {
    return { ok: true, content: body, title: article?.title || undefined };
  }
  return {
    ok: false,
    reason: "Almost no readable text found; the page likely needs JavaScript.",
  };
}

async function extractWithReadability(url: string): Promise<Extraction> {
  const response = await fetchWithRetry(url, FETCH_TIMEOUT_MS, {
    "User-Agent": READ_USER_AGENT,
    Accept: "text/html,*/*",
  });

  if (!response) {
    return { ok: false, reason: "Network error or timeout." };
  }
  if (!response.ok) return statusReason(response.status);

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !contentType.includes("text/html")) {
    return { ok: false, reason: `Unsupported content type '${contentType}'.` };
  }

  return htmlToMarkdown(await response.text(), url);
}

const JINA_ERROR_RE = /^(?:Title:.*\n+)?(?:URL Source:.*\n+)?Warning: Target URL returned error (\d{3})/i;

async function extractWithJina(url: string): Promise<Extraction> {
  const jinaUrl = `https://r.jina.ai/${url}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(jinaUrl, JINA_TIMEOUT_MS, {
      Accept: "text/plain",
      "X-Return-Format": "markdown",
      "X-Remove-Selector": "nav, header, footer, aside",
    });
  } catch {
    return { ok: false, reason: "Network error or timeout." };
  }

  if (!response.ok) return statusReason(response.status);

  const text = (await response.text()).trim();
  const jinaError = text.match(JINA_ERROR_RE);
  if (jinaError) return statusReason(Number(jinaError[1]));
  if (text.length < MIN_ACCEPTABLE_CONTENT_CHARS) {
    return { ok: false, reason: "Almost no readable text found." };
  }
  return { ok: true, content: text };
}

export default class WebReadPlugin implements BeePlugin<WebReadSchema> {
  name = "web_read";
  description =
    "Fetches and returns the full text content of a specific URL or webpage. Use this tool to read the actual content of a page — for example, to read articles, documentation, or any page whose URL you already know. This is the complement to a web search tool: after a search returns a list of URLs and short snippets, use this tool to read the full content of individual URLs. Returns the readable text extracted from the page (titles, paragraphs, article body) preceded by a short Source/Title/Length header. Long pages are returned in chunks of about 20,000 characters: follow the '[Showing chars ...]' note and call again with the given offset to continue. On failure the message explains why (e.g. HTTP 410 page gone, blocked, needs JavaScript) so you can pick another source. Do NOT use this tool to search the web — it cannot discover URLs, it only reads a URL you provide.";

  schema = readSchema;
  returnDescription =
    "Returns the full readable text content extracted from the page: title, headings, paragraphs, and article body as a single plain-text string. Content can be long (entire articles or documentation pages).";

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
      description: "Offset beyond the end of the page is reported, not silently empty",
      kind: "edge",
      params: { url: "https://example.com", offset: 1_000_000 },
      expect: (output: string) => output.includes("beyond the end"),
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

    const { url, offset = 0 } = parsed.data;

    const check = validateUrl(url);
    if (!check.ok) {
      return `Cannot fetch '${url}': ${check.reason}`;
    }

    const render = (content: string, title?: string): string => {
      const header = `Source: ${url}${title ? `\nTitle: ${title}` : ""}\nLength: ${content.length} chars\n\n`;
      return header + paginate(content, offset);
    };

    if (isPdfUrl(url)) {
      this.context?.reportStep("Extracting PDF via Jina");
      const jinaResult = await extractWithJina(url);
      if (jinaResult.ok) return render(jinaResult.content);
      return `Failed to extract content from PDF '${url}'. ${jinaResult.reason}`;
    }

    const target = toReadableUrl(url);

    this.context?.reportStep("Extracting content with Readability");
    const readabilityResult = await extractWithReadability(target);
    if (readabilityResult.ok) {
      return render(readabilityResult.content, readabilityResult.title);
    }
    if (readabilityResult.permanent) {
      return `Failed to extract readable content from '${url}'. ${readabilityResult.reason}`;
    }

    this.context?.reportStep("Falling back to Jina Reader");
    const jinaResult = await extractWithJina(url);
    if (jinaResult.ok) return render(jinaResult.content, jinaResult.title);

    return `Failed to extract readable content from '${url}'. Direct fetch: ${readabilityResult.reason} Jina fallback: ${jinaResult.reason}`;
  }
}
