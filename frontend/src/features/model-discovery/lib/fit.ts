import type { FitStatus } from "../types";

export const FIT_LABEL: Record<FitStatus, string> = {
  fits: "Fits your hardware",
  slow: "Runs slowly",
  no_fit: "Too big",
};

export const FIT_VARIANT: Record<FitStatus, "default" | "secondary" | "destructive"> = {
  fits: "default",
  slow: "secondary",
  no_fit: "destructive",
};

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatContext(tokens: number | null): string | null {
  if (!tokens) return null;
  return tokens >= 1000 ? `${Math.round(tokens / 1024)}K context` : `${tokens} context`;
}
