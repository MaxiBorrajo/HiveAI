export type ProviderErrorKind =
  | "invalid_key"
  | "rate_limit"
  | "network"
  | "model_unavailable"
  | "unknown";

export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    message: string,
    public readonly provider?: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class ModelUnavailableError extends ProviderError {
  constructor(message: string, provider?: string) {
    super("model_unavailable", message, provider);
    this.name = "ModelUnavailableError";
  }
}

function statusOf(error: unknown): number | undefined {
  const e = error as {
    status?: number;
    statusCode?: number;
    response?: { status?: number };
  };
  const status = e?.status ?? e?.statusCode ?? e?.response?.status;
  if (typeof status === "number") return status;
  const match = /\b(401|403|429)\b/.exec(String((error as Error)?.message));
  return match ? Number(match[1]) : undefined;
}

// The provider's own text says which limit was hit (per minute, per day,
// tokens...), so keep it, trimmed, instead of replacing it with a generic line.
function providerDetail(raw: string): string {
  const detail = raw.replace(/\s+/g, " ").trim();
  if (!detail) return "";
  return ` Provider said: ${detail.length > 300 ? `${detail.slice(0, 300)}…` : detail}`;
}

export function normalizeProviderError(
  error: unknown,
  provider?: string,
): ProviderError {
  if (error instanceof ProviderError) return error;

  const name = provider ? ` (${provider})` : "";
  const status = statusOf(error);
  const raw = error instanceof Error ? error.message : String(error);

  if (status === 401 || status === 403) {
    return new ProviderError(
      "invalid_key",
      `The API key was rejected by the provider${name}. Check or replace it in API keys.`,
      provider,
    );
  }

  if (status === 429) {
    return new ProviderError(
      "rate_limit",
      `The provider${name} rate limit or quota was reached. Try again later.${providerDetail(raw)}`,
      provider,
    );
  }

  if (
    /fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|network|socket|getaddrinfo/i.test(
      raw,
    )
  ) {
    return new ProviderError(
      "network",
      `Could not reach the provider${name}. Check your connection.`,
      provider,
    );
  }

  if (/failed to parse stream/i.test(raw)) {
    return new ProviderError(
      "unknown",
      `The response stream from the provider${name} was cut off. This usually means a rate limit, quota or an overloaded model; try again in a moment.`,
      provider,
    );
  }

  return new ProviderError("unknown", `Provider error${name}: ${raw}`, provider);
}
