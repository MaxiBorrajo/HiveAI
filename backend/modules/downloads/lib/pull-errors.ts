export type PullErrorKind =
  | "not_found"
  | "network"
  | "disk_full"
  | "ollama_down"
  | "unknown";

export interface PullFailure {
  kind: PullErrorKind;
  message: string;
}

export function mapPullError(error: unknown, name: string): PullFailure {
  const raw = error instanceof Error ? error.message : String(error);
  const text = raw.toLowerCase();
  const cause = String((error as { cause?: { code?: string } })?.cause?.code ?? "")
    .toLowerCase();

  if (
    text.includes("does not exist") || text.includes("file does not exist") ||
    text.includes("not found") || text.includes("manifest unknown") ||
    text.includes("pull model manifest: 404")
  ) {
    return {
      kind: "not_found",
      message: `Model '${name}' was not found in the Ollama registry. Check the name and tag (for example gemma3n:e4b).`,
    };
  }
  if (text.includes("no space left") || text.includes("disk full")) {
    return {
      kind: "disk_full",
      message: "There is not enough free disk space to download this model. Free some space or delete a model you no longer use.",
    };
  }
  if (
    cause.includes("econnrefused") ||
    (text.includes("fetch failed") && cause === "") ||
    text.includes("127.0.0.1:11434") || text.includes("localhost:11434")
  ) {
    return {
      kind: "ollama_down",
      message: "Ollama is not responding. Make sure Ollama is installed and running, then retry.",
    };
  }
  if (
    text.includes("no such host") || text.includes("i/o timeout") ||
    text.includes("connection") || text.includes("network") ||
    text.includes("dial tcp") || text.includes("eof") ||
    text.includes("timeout") || text.includes("tls")
  ) {
    return {
      kind: "network",
      message: "The download was interrupted by a network problem. Check your connection and retry; already downloaded parts are reused.",
    };
  }
  return { kind: "unknown", message: `Could not download '${name}': ${raw}` };
}
