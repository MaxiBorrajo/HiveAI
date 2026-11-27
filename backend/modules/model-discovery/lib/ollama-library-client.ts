const OLLAMA = "https://ollama.com";
const CACHE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 8000;

export class LibraryUnavailableError extends Error {}

export type LibrarySort = "popular" | "newest";

/** Capability labels ollama.com shows on a model: tools, vision, thinking, embedding, cloud. */
export type LibraryCapability = string;

export interface LibraryModel {
  name: string;
  description: string;
  capabilities: LibraryCapability[];
  /** parameter counts in billions, one per size the model is published in */
  sizes: number[];
  pulls: number;
}

export interface LibraryTag {
  /** e.g. "8b" or "8b-q8_0" (the model is pulled as "name:tag") */
  tag: string;
  digest: string;
  sizeBytes: number;
  contextLength: number | null;
}

export interface LibraryDetail {
  model: LibraryModel;
  tags: LibraryTag[];
}

export interface LibrarySearchOptions {
  sort?: LibrarySort;
  /** ollama.com category filters, e.g. "tools", "vision", "thinking", "embedding" */
  categories?: string[];
}

function decode(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .trim();
}

/** "0.8b" -> 0.8, "270m" -> 0.27; null for labels that are not a size. */
function parseParams(label: string): number | null {
  const m = /^(\d+(?:\.\d+)?)([bm])$/i.exec(label.trim());
  if (!m) return null;
  const value = Number(m[1]);
  return m[2].toLowerCase() === "b" ? value : Math.round(value) / 1000;
}

const CAPABILITY_CLASS = "bg-indigo-50";
const SIZE_CLASS = "bg-[#ddf4ff]";

function badges(block: string, cssClass: string): string[] {
  const re = new RegExp(`<span[^>]*class="[^"]*${cssClass.replace(/[[\]#]/g, "\\$&")}[^"]*"[^>]*>([^<]+)</span>`, "g");
  return [...block.matchAll(re)].map((m) => decode(m[1]));
}

/** Parses the result list of ollama.com/search. Pure so it can be tested against saved pages. */
export function parseSearchHtml(html: string): LibraryModel[] {
  const models: LibraryModel[] = [];
  for (const block of html.split("<li ").slice(1)) {
    const name = /href="\/library\/([^"/:?]+)"/.exec(block)?.[1];
    if (!name) continue;
    const description = /<p class="mt-1[^"]*"[^>]*>([^<]*)<\/p>/.exec(block)?.[1] ?? "";
    const pulls = /title="([\d,]+) downloads"/.exec(block)?.[1] ?? "0";
    models.push({
      name,
      description: decode(description),
      capabilities: badges(block, CAPABILITY_CLASS),
      sizes: badges(block, SIZE_CLASS).map(parseParams).filter((s): s is number => s !== null),
      pulls: Number(pulls.replace(/,/g, "")),
    });
  }
  return models;
}

const UNITS: Record<string, number> = { KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 };

function parseBytes(text: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB)$/i.exec(text.trim());
  return m ? Math.round(Number(m[1]) * UNITS[m[2].toUpperCase()]) : null;
}

/** "40K" -> 40960, "1M" -> 1048576 */
function parseContext(text: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*([KM])$/i.exec(text.trim());
  if (!m) return null;
  return Math.round(Number(m[1]) * (m[2].toUpperCase() === "K" ? 1024 : 1024 * 1024));
}

/** Parses ollama.com/library/<name>/tags. Cloud-only tags have no size and are skipped. */
export function parseTagsHtml(html: string, name: string): LibraryTag[] {
  const tags: LibraryTag[] = [];
  const seen = new Set<string>();
  for (const block of html.split('<div class="group px-4 py-3">').slice(1)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tag = new RegExp(`href="/library/${escaped}:([^"]+)"`).exec(block)?.[1];
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    const digest = /<span class="font-mono">\s*([0-9a-f]+)\s*<\/span>/.exec(block)?.[1];
    const info = /•\s*([\d.]+\s*[KMGT]B)\s*•\s*(?:([\d.]+\s*[KM]) context window)?/i.exec(block);
    const sizeBytes = info ? parseBytes(info[1]) : null;
    if (!digest || sizeBytes === null) continue;
    tags.push({
      tag,
      digest,
      sizeBytes,
      contextLength: info?.[2] ? parseContext(info[2]) : null,
    });
  }
  return tags;
}

export function parseDescription(html: string): string {
  return decode(/<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? "");
}

export class LibraryClient {
  private cache = new Map<string, { at: number; value: string }>();

  constructor(private fetchFn: typeof fetch = fetch) {}

  async search(query: string, options: LibrarySearchOptions = {}): Promise<LibraryModel[]> {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (options.sort === "newest") params.set("o", "newest");
    // models that only run on Ollama's cloud cannot be pulled
    for (const c of ["local", ...(options.categories ?? [])]) params.append("c", c);
    return parseSearchHtml(await this.get(`${OLLAMA}/search?${params}`));
  }

  /** null when ollama.com has no model with this exact name */
  async getModel(name: string): Promise<LibraryDetail | null> {
    const base = `${OLLAMA}/library/${encodeURIComponent(name)}`;
    const [found, tagsHtml, pageHtml] = await Promise.all([
      this.search(name),
      this.get(`${base}/tags`),
      this.get(base),
    ]);
    const tags = parseTagsHtml(tagsHtml, name);
    const listed = found.find((m) => m.name === name);
    if (!listed && tags.length === 0) return null;
    return {
      model: {
        name,
        description: listed?.description || parseDescription(pageHtml),
        capabilities: listed?.capabilities ?? [],
        sizes: listed?.sizes ?? [],
        pulls: listed?.pulls ?? 0,
      },
      tags,
    };
  }

  private async get(url: string): Promise<string> {
    const cached = this.cache.get(url);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
    let res: Response;
    try {
      res = await this.fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new LibraryUnavailableError("ollama.com could not be reached.");
    }
    if (res.status === 404) return "";
    if (!res.ok) throw new LibraryUnavailableError(`ollama.com answered ${res.status}.`);
    const value = await res.text();
    this.cache.set(url, { at: Date.now(), value });
    return value;
  }
}

let shared: LibraryClient | undefined;
export function getLibraryClient(): LibraryClient {
  return (shared ??= new LibraryClient());
}
