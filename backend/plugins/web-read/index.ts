// deno-lint-ignore-file no-explicit-any
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 10_000;
const JINA_TIMEOUT_MS = 20_000;
const MAX_CONTENT_CHARS = 20_000;
const MIN_ACCEPTABLE_CONTENT_CHARS = 200;
const MAX_HTML_CHARS = 4_000_000;
const MAX_FETCH_RETRIES = 2;
const RETRY_BACKOFF_MS = 500;
const MAX_RETRY_AFTER_S = 3;
const MAX_REDIRECTS = 5;
const PER_HOST_MIN_INTERVAL_MS = 800;
const MAX_THREAD_COMMENTS = 250;
const MAX_COMMENT_CHARS = 1_500;

const READ_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const API_USER_AGENT = "web:bee-web-read:1.0 (research agent)";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": READ_USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
  "Upgrade-Insecure-Requests": "1",
};

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});
// Images and embeds only burn tokens; the agent reads text.
turndown.remove([
  "script",
  "style",
  "noscript",
  "iframe",
  "svg",
  "img",
  "picture",
  "video",
  "audio",
  "canvas",
]);

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// SSRF protection (unchanged logic)
// ---------------------------------------------------------------------------

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
      // no record of this type
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
      reason:
        `Protocol '${url.protocol}' is not allowed. Only http/https are permitted.`,
    };
  }

  if (isBlockedHost(url.hostname)) {
    return {
      ok: false,
      reason:
        `Host '${url.hostname}' resolves to a private or local address and cannot be fetched.`,
    };
  }

  return { ok: true, url };
}

// ---------------------------------------------------------------------------
// Networking
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Minimum spacing between two requests to the same host, so an agent that
// reads many pages of one site does not trip that site's rate limiter.
const hostNextSlot = new Map<string, number>();

async function throttleHost(hostname: string): Promise<void> {
  const now = Date.now();
  const slot = Math.max(hostNextSlot.get(hostname) ?? 0, now);
  hostNextSlot.set(hostname, slot + PER_HOST_MIN_INTERVAL_MS);
  if (slot > now) await sleep(slot - now);
}

async function fetchWithTimeout(
  url: string,
  ms: number,
  headers: Record<string, string> = {},
  trusted = false,
  init: RequestInit = {},
): Promise<Response> {
  if (!trusted) {
    try {
      await throttleHost(new URL(url).hostname);
    } catch {
      // invalid URL: validation below reports it
    }
  }

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
        ...init,
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

// ---------------------------------------------------------------------------
// Types & shared helpers
// ---------------------------------------------------------------------------

type Extraction =
  | {
    ok: true;
    content: string;
    title?: string;
    published?: string;
    method: string;
  }
  | { ok: false; reason: string; permanent?: boolean };

function isPdfUrl(url: string): boolean {
  return /\.pdf(\?|#|$)/i.test(url);
}

function statusReason(status: number): Extraction & { ok: false } {
  if (status === 404 || status === 410) {
    return {
      ok: false,
      permanent: true,
      reason:
        `HTTP ${status}: the page no longer exists. Do not retry; use another source.`,
    };
  }
  if (status === 401 || status === 403 || status === 429) {
    return {
      ok: false,
      reason:
        `HTTP ${status}: the site blocks or rate-limits automated access. Try a different source.`,
    };
  }
  return { ok: false, reason: `HTTP ${status} error.` };
}

function tidyMarkdown(md: string): string {
  return md
    .replace(/\[\s*\]\([^)]*\)/g, "") // empty links left behind by removed images
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

function isoDay(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "number") {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? s.slice(0, 40)
    : d.toISOString().slice(0, 10);
}

function oneLine(text: unknown, max = MAX_COMMENT_CHARS): string {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

function htmlFragmentToText(html: unknown): string {
  const s = String(html ?? "");
  if (!s) return "";
  try {
    return turndown.turndown(s).trim();
  } catch {
    return s.replace(/<[^>]+>/g, " ");
  }
}

// ---------------------------------------------------------------------------
// HTML -> markdown (generic pages)
// ---------------------------------------------------------------------------

const NOISE_SELECTORS =
  "nav, footer, aside, [role=navigation], [role=banner], [role=contentinfo], [aria-label*=cookie i], [id*=cookie i], [class*=cookie i]";

/** Removes boilerplate, but never an element that holds most of the page text. */
function stripNoise(root: any): void {
  const total = (root.textContent ?? "").length || 1;
  root.querySelectorAll(NOISE_SELECTORS).forEach((el: any) => {
    if ((el.textContent ?? "").length > total * 0.6) return;
    el.remove();
  });
}

function findDateInJsonLd(node: any, depth = 0): string | undefined {
  if (!node || depth > 4) return undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findDateInJsonLd(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof node === "object") {
    if (node.datePublished) return isoDay(node.datePublished);
    if (node["@graph"]) return findDateInJsonLd(node["@graph"], depth + 1);
  }
  return undefined;
}

const DATE_META_KEYS = new Set([
  "article:published_time",
  "og:article:published_time",
  "datepublished",
  "pubdate",
  "publishdate",
  "date",
  "dc.date.issued",
  "dc.date",
  "sailthru.date",
  "parsely-pub-date",
  "created",
]);

/** Publication date from meta tags, JSON-LD or the first <time datetime>. */
function extractPublished(doc: any): string | undefined {
  for (const meta of Array.from(doc.querySelectorAll("meta")) as any[]) {
    const key = (meta.getAttribute("property") ?? meta.getAttribute("name") ??
      meta.getAttribute("itemprop") ?? "").toLowerCase();
    if (DATE_META_KEYS.has(key)) {
      const value = isoDay(meta.getAttribute("content"));
      if (value) return value;
    }
  }
  for (
    const script of Array.from(
      doc.querySelectorAll('script[type="application/ld+json"]'),
    ) as any[]
  ) {
    try {
      const found = findDateInJsonLd(JSON.parse(script.textContent ?? ""));
      if (found) return found;
    } catch {
      // malformed JSON-LD
    }
  }
  const time = doc.querySelector("time[datetime]");
  return isoDay(time?.getAttribute("datetime"));
}

/** Forum / comment-heavy markup: Readability tends to throw the replies away. */
function looksLikeDiscussion(bodyHtml: string): boolean {
  const hits = bodyHtml.match(
    /(?:class|id)="[^"]*(?:comment|reply|thread|post-message|topic)[^"]*"/gi,
  );
  return (hits?.length ?? 0) >= 5;
}

function htmlToMarkdown(rawHtml: string, url: string): Extraction {
  const html = rawHtml.length > MAX_HTML_CHARS
    ? rawHtml.slice(0, MAX_HTML_CHARS)
    : rawHtml;

  let dom: JSDOM;
  try {
    dom = new JSDOM(html, { url });
  } catch {
    return { ok: false, reason: "The page HTML could not be parsed." };
  }

  try {
    const doc: any = dom.window.document;
    const published = extractPublished(doc);
    const pageTitle = doc.title?.trim() || undefined;

    // Snapshot BEFORE Readability mutates the document.
    const bodyClone = doc.body?.cloneNode(true) as any;
    const bodyHtml = bodyClone?.innerHTML ?? "";
    let bodyMarkdown: string | undefined;
    const getBodyMarkdown = (): string => {
      if (bodyMarkdown !== undefined) return bodyMarkdown;
      if (!bodyClone) return (bodyMarkdown = "");
      stripNoise(bodyClone);
      return (bodyMarkdown = tidyMarkdown(turndown.turndown(bodyClone.innerHTML)));
    };

    const article = new Readability(doc).parse() as any;
    const readableMarkdown = article?.content
      ? tidyMarkdown(turndown.turndown(article.content))
      : "";
    const title = article?.title || pageTitle;
    const date = published ?? isoDay(article?.publishedTime);

    if (readableMarkdown.length >= MIN_ACCEPTABLE_CONTENT_CHARS) {
      // Discussion pages: if Readability kept under half of the page, the
      // replies were dropped. Prefer the whole (de-noised) body.
      if (looksLikeDiscussion(bodyHtml)) {
        const body = getBodyMarkdown();
        if (body.length > 2_500 && readableMarkdown.length < body.length * 0.5) {
          return {
            ok: true,
            content: body,
            title,
            published: date,
            method: "full page (discussion thread)",
          };
        }
      }
      return {
        ok: true,
        content: readableMarkdown,
        title,
        published: date,
        method: "readability",
      };
    }

    const body = getBodyMarkdown();
    if (body.length >= MIN_ACCEPTABLE_CONTENT_CHARS) {
      return { ok: true, content: body, title, published: date, method: "full page" };
    }
    return {
      ok: false,
      reason: "Almost no readable text found; the page likely needs JavaScript.",
    };
  } finally {
    dom.window.close();
  }
}

async function extractWithReadability(url: string): Promise<Extraction> {
  const response = await fetchWithRetry(url, FETCH_TIMEOUT_MS, BROWSER_HEADERS);

  if (!response) {
    return { ok: false, reason: "Network error or timeout." };
  }
  if (!response.ok) {
    await response.body?.cancel();
    return statusReason(response.status);
  }

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();

  if (contentType.includes("application/pdf")) {
    await response.body?.cancel();
    return { ok: false, reason: "The URL is a PDF." }; // handled by the Jina fallback
  }

  if (contentType.includes("json")) {
    const text = await response.text();
    try {
      return {
        ok: true,
        content: JSON.stringify(JSON.parse(text), null, 1),
        method: "json",
      };
    } catch {
      return { ok: true, content: text, method: "text" };
    }
  }

  if (
    contentType.startsWith("text/plain") ||
    contentType.includes("markdown") ||
    contentType.includes("xml")
  ) {
    return { ok: true, content: (await response.text()).trim(), method: "text" };
  }

  if (contentType && !contentType.includes("html")) {
    await response.body?.cancel();
    return { ok: false, reason: `Unsupported content type '${contentType}'.` };
  }

  return htmlToMarkdown(await response.text(), url);
}

// ---------------------------------------------------------------------------
// Jina Reader fallback (JavaScript pages, PDFs, blocked sites)
// ---------------------------------------------------------------------------

const JINA_ERROR_RE =
  /^(?:Title:.*\n+)?(?:URL Source:.*\n+)?Warning: Target URL returned error (\d{3})/i;

async function extractWithJina(
  url: string,
  apiKey?: string,
): Promise<Extraction> {
  const headers: Record<string, string> = {
    Accept: "text/plain",
    "X-Return-Format": "markdown",
    "X-Remove-Selector": "nav, header, footer, aside",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(
      `https://r.jina.ai/${url}`,
      JINA_TIMEOUT_MS,
      headers,
      true,
    );
  } catch {
    return { ok: false, reason: "Network error or timeout." };
  }

  if (!response.ok) {
    await response.body?.cancel();
    return statusReason(response.status);
  }

  const text = (await response.text()).trim();
  const jinaError = text.match(JINA_ERROR_RE);
  if (jinaError) return statusReason(Number(jinaError[1]));

  // Jina prefixes "Title:", "URL Source:", "Published Time:", "Markdown Content:".
  const title = text.match(/^Title:\s*(.+)$/m)?.[1]?.trim();
  const published = isoDay(text.match(/^Published Time:\s*(.+)$/m)?.[1]);
  const marker = "Markdown Content:";
  const markerAt = text.indexOf(marker);
  const content = tidyMarkdown(
    markerAt >= 0 ? text.slice(markerAt + marker.length) : text,
  );

  if (content.length < MIN_ACCEPTABLE_CONTENT_CHARS) {
    return { ok: false, reason: "Almost no readable text found." };
  }
  return { ok: true, content, title, published, method: "jina reader" };
}

// ---------------------------------------------------------------------------
// Hacker News: use the Algolia API (full thread with dates and points)
// ---------------------------------------------------------------------------

function hackerNewsItemId(url: URL): string | null {
  if (url.hostname === "news.ycombinator.com" && url.pathname === "/item") {
    const id = url.searchParams.get("id");
    return id && /^\d+$/.test(id) ? id : null;
  }
  return null;
}

function isAlgoliaApiUrl(url: URL): boolean {
  return url.hostname === "hn.algolia.com" &&
    url.pathname.startsWith("/api/v1/search");
}

function flattenHnComments(
  children: any[],
  depth: number,
  out: string[],
  counter: { n: number },
): void {
  for (const c of children ?? []) {
    if (counter.n >= MAX_THREAD_COMMENTS) return;
    if (c?.text) {
      counter.n++;
      const date = isoDay(c.created_at);
      out.push(
        `${"  ".repeat(Math.min(depth, 6))}- **${c.author ?? "unknown"}**${
          date ? ` (${date})` : ""
        }: ${oneLine(htmlFragmentToText(c.text))}`,
      );
    }
    if (Array.isArray(c?.children)) {
      flattenHnComments(c.children, depth + 1, out, counter);
    }
  }
}

async function extractHackerNews(id: string): Promise<Extraction> {
  const response = await fetchWithRetry(
    `https://hn.algolia.com/api/v1/items/${id}`,
    FETCH_TIMEOUT_MS,
    { "User-Agent": API_USER_AGENT, Accept: "application/json" },
  );
  if (!response) return { ok: false, reason: "Network error or timeout." };
  if (!response.ok) {
    await response.body?.cancel();
    return statusReason(response.status);
  }

  let item: any;
  try {
    item = await response.json();
  } catch {
    return { ok: false, reason: "Hacker News API returned invalid JSON." };
  }

  const lines: string[] = [];
  const title = item.title ? String(item.title) : undefined;
  if (title) lines.push(`# ${title}`);
  const meta = [
    item.author ? `by ${item.author}` : "",
    isoDay(item.created_at) ?? "",
    item.points !== null && item.points !== undefined
      ? `${item.points} points`
      : "",
    item.url ? `link: ${item.url}` : "",
  ].filter(Boolean);
  if (meta.length) lines.push(meta.join(" · "));
  if (item.text) lines.push("", htmlFragmentToText(item.text));

  const comments: string[] = [];
  const counter = { n: 0 };
  flattenHnComments(item.children ?? [], 0, comments, counter);
  lines.push("", `## Comments (${counter.n} shown)`, "", ...comments);

  const content = tidyMarkdown(lines.join("\n"));
  if (content.length < 20) {
    return { ok: false, reason: "Empty Hacker News item." };
  }
  return {
    ok: true,
    content,
    title,
    published: isoDay(item.created_at),
    method: "hacker news api",
  };
}

async function extractAlgoliaSearch(url: string): Promise<Extraction> {
  const response = await fetchWithRetry(url, FETCH_TIMEOUT_MS, {
    "User-Agent": API_USER_AGENT,
    Accept: "application/json",
  });
  if (!response) return { ok: false, reason: "Network error or timeout." };
  if (!response.ok) {
    await response.body?.cancel();
    return statusReason(response.status);
  }

  let data: any;
  try {
    data = await response.json();
  } catch {
    return { ok: false, reason: "Algolia returned invalid JSON." };
  }

  const hits: any[] = Array.isArray(data?.hits) ? data.hits : [];
  const lines = [`Algolia Hacker News search: ${data?.nbHits ?? hits.length} hits (showing ${hits.length})`, ""];
  hits.forEach((h, i) => {
    const isComment = !!h.comment_text;
    const heading = h.title ?? h.story_title ?? "(no title)";
    const link = `https://news.ycombinator.com/item?id=${
      isComment ? h.story_id ?? h.objectID : h.objectID
    }`;
    const bits = [
      isComment ? "comment" : "story",
      isoDay(h.created_at) ?? "",
      h.author ? `by ${h.author}` : "",
      h.points !== null && h.points !== undefined ? `${h.points} pts` : "",
      h.num_comments !== null && h.num_comments !== undefined
        ? `${h.num_comments} comments`
        : "",
    ].filter(Boolean);
    lines.push(`${i + 1}. ${heading} [${bits.join(" · ")}]`);
    lines.push(`   ${link}`);
    const body = h.comment_text ?? h.story_text;
    if (body) lines.push(`   ${oneLine(htmlFragmentToText(body), 700)}`);
  });

  return { ok: true, content: lines.join("\n"), method: "hacker news search api" };
}

// ---------------------------------------------------------------------------
// Reddit: the .json endpoint (optionally through OAuth) gives the full thread
// ---------------------------------------------------------------------------

function isRedditPostUrl(url: URL): boolean {
  return /(^|\.)reddit\.com$/.test(url.hostname) &&
    /\/comments\/[a-z0-9]+/i.test(url.pathname);
}

let redditToken: { value: string; expires: number } | null = null;

async function getRedditToken(
  clientId: string,
  clientSecret: string,
): Promise<string | null> {
  if (redditToken && redditToken.expires > Date.now() + 60_000) {
    return redditToken.value;
  }
  try {
    const response = await fetchWithTimeout(
      "https://www.reddit.com/api/v1/access_token",
      FETCH_TIMEOUT_MS,
      {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": API_USER_AGENT,
      },
      true,
      { method: "POST", body: "grant_type=client_credentials" },
    );
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    const data = await response.json();
    if (!data?.access_token) return null;
    redditToken = {
      value: String(data.access_token),
      expires: Date.now() + Number(data.expires_in ?? 3600) * 1000,
    };
    return redditToken.value;
  } catch {
    return null;
  }
}

function flattenRedditComments(
  children: any[],
  depth: number,
  out: string[],
  counter: { n: number },
): void {
  for (const c of children ?? []) {
    if (counter.n >= MAX_THREAD_COMMENTS) return;
    if (c?.kind !== "t1") continue;
    const d = c.data ?? {};
    const body = d.body;
    if (body && body !== "[deleted]" && body !== "[removed]") {
      counter.n++;
      const date = isoDay(d.created_utc);
      out.push(
        `${"  ".repeat(Math.min(depth, 6))}- **u/${d.author ?? "unknown"}** (${
          d.score ?? 0
        } pts${date ? `, ${date}` : ""}): ${oneLine(body)}`,
      );
    }
    const replies = d.replies?.data?.children;
    if (Array.isArray(replies)) {
      flattenRedditComments(replies, depth + 1, out, counter);
    }
  }
}

async function extractReddit(
  url: URL,
  credentials?: { id: string; secret: string },
): Promise<Extraction> {
  const path = url.pathname.replace(/\/+$/, "");
  const query = "limit=300&depth=8&raw_json=1&sort=top";

  const token = credentials
    ? await getRedditToken(credentials.id, credentials.secret)
    : null;
  const apiUrl = token
    ? `https://oauth.reddit.com${path}.json?${query}`
    : `https://www.reddit.com${path}.json?${query}`;
  const headers: Record<string, string> = {
    "User-Agent": API_USER_AGENT,
    Accept: "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetchWithRetry(apiUrl, FETCH_TIMEOUT_MS, headers);
  if (!response) return { ok: false, reason: "Network error or timeout." };
  if (!response.ok) {
    await response.body?.cancel();
    return statusReason(response.status);
  }

  let data: any;
  try {
    data = await response.json();
  } catch {
    return { ok: false, reason: "Reddit returned a non-JSON response." };
  }

  const post = data?.[0]?.data?.children?.[0]?.data;
  if (!post) return { ok: false, reason: "Reddit thread not found in response." };

  const title = String(post.title ?? "");
  const date = isoDay(post.created_utc);
  const ratio = typeof post.upvote_ratio === "number"
    ? ` (${Math.round(post.upvote_ratio * 100)}% upvoted)`
    : "";

  const lines = [
    `# ${title}`,
    [
      post.subreddit_name_prefixed ?? "",
      post.author ? `u/${post.author}` : "",
      date ?? "",
      `${post.score ?? 0} points${ratio}`,
      `${post.num_comments ?? 0} comments`,
    ].filter(Boolean).join(" · "),
  ];
  if (post.selftext) lines.push("", String(post.selftext).trim());

  const comments: string[] = [];
  const counter = { n: 0 };
  flattenRedditComments(data?.[1]?.data?.children ?? [], 0, comments, counter);
  lines.push("", `## Comments (top ${counter.n} shown, sorted by votes)`, "", ...comments);

  return {
    ok: true,
    content: tidyMarkdown(lines.join("\n")),
    title,
    published: date,
    method: token ? "reddit oauth api" : "reddit json",
  };
}

/** old.reddit.com renders server-side, which works better for the HTML path. */
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

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default class WebReadPlugin implements BeePlugin<WebReadSchema> {
  name = "web_read";
  description =
    "Fetches and returns the full text of a specific URL. Use it to read the actual content of a page whose URL you already know (articles, documentation, forum threads, reviews, PDFs): it is the complement of a web search tool, which only returns URLs and short snippets. Returns clean text preceded by a header with Source, Title, Published date (when the page declares one), the extraction method and Length. For discussion sites it returns the whole thread including replies: Hacker News items (with dates and points) and Reddit posts (with votes) come from their JSON APIs. It can also read Algolia Hacker News search URLs (https://hn.algolia.com/api/v1/search?query=...&tags=comment) and returns the hits as a compact list. Long pages are returned in chunks of about 20,000 characters: follow the '[Showing chars ...]' note and call again with the given offset to continue. On failure the message explains why (page gone, blocked, needs JavaScript) so you can pick another source; do not retry a URL that failed. It cannot search the web or discover URLs.";

  schema = readSchema;
  returnDescription =
    "Returns the readable text of the page as markdown-like plain text, with a header (Source, Title, Published, Via, Length). Content can be long; follow the '[Showing chars ...]' note to continue.";

  configFields = [
    {
      key: "REDDIT_CLIENT_ID",
      label: "Reddit app client id (optional, makes Reddit threads reliable)",
      secret: false,
    },
    {
      key: "REDDIT_CLIENT_SECRET",
      label: "Reddit app client secret (optional)",
      secret: true,
    },
    {
      key: "JINA_API_KEY",
      label: "Jina Reader API key (optional, higher rate limits)",
      secret: true,
    },
  ];

  selectionTests: SelectionTestCase<WebReadSchema>[] = [
    {
      query: "summarize this article: https://example.com/article",
      kind: "positive",
      shouldInvoke: true,
      expectedParams: { url: "https://example.com/article" },
    },
    {
      query: "read this and tell me what it says: https://news.example.com/story",
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
      query: "read the whole thread including comments: https://news.ycombinator.com/item?id=8863",
      kind: "positive",
      shouldInvoke: true,
      expectedParams: { url: "https://news.ycombinator.com/item?id=8863" },
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
    { query: "check this out", kind: "ambiguous" },
    { query: "tell me more about that", kind: "ambiguous" },
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
      description: "Hacker News item is read through the API with comments",
      kind: "happy",
      params: { url: "https://news.ycombinator.com/item?id=8863" },
      expect: (output: string) =>
        output.includes("Dropbox") && output.includes("## Comments"),
    },
    {
      description: "Algolia Hacker News search URL is rendered as a list",
      kind: "happy",
      params: {
        url: "https://hn.algolia.com/api/v1/search?query=duckdb&tags=story&hitsPerPage=5",
      },
      expect: (output: string) =>
        output.toLowerCase().includes("duckdb") &&
        output.includes("news.ycombinator.com/item?id="),
    },
    {
      description: "Header reports the extraction method",
      kind: "happy",
      params: { url: "https://example.com" },
      expect: (output: string) => output.includes("Via: "),
    },
    {
      description: "Reddit post URL returns content or a clear failure",
      kind: "edge",
      params: { url: "https://www.reddit.com/r/programming/comments/abc123/test/" },
      expect: (output: string) =>
        output.startsWith("Source:") || output.startsWith("Failed"),
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

  private async cfg(key: string): Promise<string | undefined> {
    const value = await this.context?.getConfig(key);
    const trimmed = typeof value === "string" ? value.trim() : "";
    return trimmed || undefined;
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

    const render = (r: Extract<Extraction, { ok: true }>): string => {
      const header = [
        `Source: ${url}`,
        r.title ? `Title: ${r.title}` : "",
        r.published ? `Published: ${r.published}` : "",
        `Via: ${r.method}`,
        `Length: ${r.content.length} chars`,
      ].filter(Boolean).join("\n");
      return `${header}\n\n${paginate(r.content, offset)}`;
    };

    const jinaKey = await this.cfg("JINA_API_KEY");
    const reasons: string[] = [];

    // 1. PDFs go straight to Jina.
    if (isPdfUrl(url)) {
      this.context?.reportStep("Extracting PDF via Jina");
      const jinaResult = await extractWithJina(url, jinaKey);
      if (jinaResult.ok) return render(jinaResult);
      return `Failed to extract content from PDF '${url}'. ${jinaResult.reason}`;
    }

    // 2. Sites with a structured API: full threads, dates and votes.
    const hnId = hackerNewsItemId(check.url);
    if (hnId) {
      this.context?.reportStep("Reading Hacker News thread via API");
      const hn = await extractHackerNews(hnId);
      if (hn.ok) return render(hn);
      reasons.push(`Hacker News API: ${hn.reason}`);
    } else if (isAlgoliaApiUrl(check.url)) {
      this.context?.reportStep("Reading Algolia search results");
      const algolia = await extractAlgoliaSearch(url);
      if (algolia.ok) return render(algolia);
      return `Failed to read '${url}'. ${algolia.reason}`;
    } else if (isRedditPostUrl(check.url)) {
      this.context?.reportStep("Reading Reddit thread");
      const [id, secret] = await Promise.all([
        this.cfg("REDDIT_CLIENT_ID"),
        this.cfg("REDDIT_CLIENT_SECRET"),
      ]);
      const reddit = await extractReddit(
        check.url,
        id && secret ? { id, secret } : undefined,
      );
      if (reddit.ok) return render(reddit);
      if (reddit.permanent) {
        return `Failed to extract readable content from '${url}'. ${reddit.reason}`;
      }
      reasons.push(`Reddit JSON: ${reddit.reason}`);
    }

    // 3. Generic page: Readability, then Jina.
    const target = toReadableUrl(url);

    this.context?.reportStep("Extracting content with Readability");
    const readabilityResult = await extractWithReadability(target);
    if (readabilityResult.ok) return render(readabilityResult);
    if (readabilityResult.permanent) {
      return `Failed to extract readable content from '${url}'. ${readabilityResult.reason}`;
    }
    reasons.push(`Direct fetch: ${readabilityResult.reason}`);

    this.context?.reportStep("Falling back to Jina Reader");
    const jinaResult = await extractWithJina(url, jinaKey);
    if (jinaResult.ok) return render(jinaResult);
    reasons.push(`Jina fallback: ${jinaResult.reason}`);

    return `Failed to extract readable content from '${url}'. ${reasons.join(" ")}`;
  }
}