export interface RegistryInfo {
  /** false = the registry answered 404 for this name/tag */
  exists: boolean;
  /** total download size in bytes, null when it could not be determined */
  sizeBytes: number | null;
}

const REGISTRY = "https://registry.ollama.ai/v2";

export function parseModelName(
  name: string,
): { repo: string; tag: string } | null {
  const trimmed = name.trim();
  if (!/^[A-Za-z0-9._\-/]+(:[A-Za-z0-9._\-]+)?$/.test(trimmed)) return null;
  const [path, tag = "latest"] = trimmed.split(":");
  const repo = path.includes("/") ? path : `library/${path}`;
  return { repo, tag };
}

/** "qwen3" and "qwen3:latest" are the same model; Ollama lists it with the explicit tag. */
export function normalizeModelName(name: string): string {
  const trimmed = name.trim().toLowerCase();
  return trimmed.includes(":") ? trimmed : `${trimmed}:latest`;
}

export function isModelInstalled(name: string, installed: string[]): boolean {
  const wanted = normalizeModelName(name);
  return installed.some((n) => normalizeModelName(n) === wanted);
}

export async function fetchRegistryInfo(
  name: string,
  fetchFn: typeof fetch = fetch,
): Promise<RegistryInfo> {
  const parsed = parseModelName(name);
  if (!parsed) return { exists: false, sizeBytes: null };
  try {
    const res = await fetchFn(
      `${REGISTRY}/${parsed.repo}/manifests/${parsed.tag}`,
      {
        headers: { accept: "application/vnd.docker.distribution.manifest.v2+json" },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (res.status === 404) return { exists: false, sizeBytes: null };
    if (!res.ok) return { exists: true, sizeBytes: null };
    const manifest = await res.json() as {
      config?: { size?: number };
      layers?: { size?: number }[];
    };
    const total = (manifest.layers ?? []).reduce((s, l) => s + (l.size ?? 0), 0) +
      (manifest.config?.size ?? 0);
    return { exists: true, sizeBytes: total > 0 ? total : null };
  } catch {
    return { exists: true, sizeBytes: null };
  }
}
