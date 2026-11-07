const HF = "https://huggingface.co";
const CACHE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 8000;

export interface HfGguf {
  total?: number;
  architecture?: string;
  context_length?: number;
  chat_template?: string;
  totalFileSize?: number;
}

export interface HfModel {
  id: string;
  downloads?: number;
  likes?: number;
  tags?: string[];
  pipeline_tag?: string;
  gguf?: HfGguf;
}

export interface HfTreeEntry {
  type: string;
  path: string;
  size?: number;
}

export class HfUnavailableError extends Error {}

export type HfSort = "downloads" | "likes" | "trendingScore" | "lastModified";

export interface HfSearchOptions {
  sort?: HfSort;
  cursor?: string;
  limit?: number;
  /** only models published by this Hugging Face user or organization */
  author?: string;
}

export interface HfSearchPage {
  models: HfModel[];
  /** opaque cursor of the next page, null when there are no more results */
  nextCursor: string | null;
}

interface Fetched<T> {
  value: T;
  link: string | null;
}

const EXPAND = ["downloads", "likes", "tags", "pipeline_tag", "gguf"]
  .map((e) => `expand[]=${e}`)
  .join("&");

export class HfClient {
  private cache = new Map<string, { at: number; value: unknown; link: string | null }>();

  constructor(private fetchFn: typeof fetch = fetch) {}

  async search(query: string, options: HfSearchOptions = {}): Promise<HfSearchPage> {
    const params = new URLSearchParams({
      filter: "gguf",
      sort: options.sort ?? "downloads",
      limit: String(options.limit ?? 12),
    });
    if (query.trim()) params.set("search", query.trim());
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.author) params.set("author", options.author);
    const { value, link } = await this.fetchCached<HfModel[]>(
      `${HF}/api/models?${params}&${EXPAND}`,
      "json",
    );
    return { models: value, nextCursor: parseNextCursor(link) };
  }

  getModel(repo: string): Promise<HfModel> {
    return this.getJson<HfModel>(`${HF}/api/models/${repo}?${EXPAND}`);
  }

  getTree(repo: string): Promise<HfTreeEntry[]> {
    return this.getJson<HfTreeEntry[]>(
      `${HF}/api/models/${repo}/tree/main?recursive=true`,
    );
  }

  async getReadme(repo: string): Promise<string> {
    try {
      return await this.get(`${HF}/${repo}/raw/main/README.md`, "text");
    } catch (error) {
      if (error instanceof HfUnavailableError) throw error;
      return "";
    }
  }

  private async getJson<T>(url: string): Promise<T> {
    return (await this.fetchCached<T>(url, "json")).value;
  }

  private async get<T>(url: string, as: "json" | "text"): Promise<T> {
    return (await this.fetchCached<T>(url, as)).value;
  }

  private async fetchCached<T>(url: string, as: "json" | "text"): Promise<Fetched<T>> {
    const cached = this.cache.get(url);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return { value: cached.value as T, link: cached.link };
    }
    let res: Response;
    try {
      res = await this.fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new HfUnavailableError("Hugging Face could not be reached.");
    }
    if (res.status === 404) throw new Error("Model not found.");
    if (!res.ok) {
      throw new HfUnavailableError(`Hugging Face answered ${res.status}.`);
    }
    const value = (as === "json" ? await res.json() : await res.text()) as T;
    const link = res.headers.get("link");
    this.cache.set(url, { at: Date.now(), value, link });
    return { value, link };
  }
}

/** Hugging Face paginates with `Link: <url?cursor=...>; rel="next"` */
export function parseNextCursor(link: string | null): string | null {
  const next = link?.split(",").find((part) => /rel="?next"?/.test(part));
  const url = next && /<([^>]+)>/.exec(next)?.[1];
  if (!url) return null;
  try {
    return new URL(url).searchParams.get("cursor");
  } catch {
    return null;
  }
}

let shared: HfClient | undefined;
export function getHfClient(): HfClient {
  return (shared ??= new HfClient());
}
