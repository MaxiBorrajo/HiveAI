import type { LangGraphAbstraction } from "../../../core/ai/visual-builder/types.ts";

export interface SecretWarning {
  nodeId: string;
  field: string;
}

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /api[_-]?key["']?\s*[:=]\s*["']?[A-Za-z0-9_-]{12,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

export function looksLikeSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function collectStrings(
  value: unknown,
  path: string,
  out: { field: string; text: string }[],
): void {
  if (typeof value === "string") {
    out.push({ field: path, text: value });
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => collectStrings(v, `${path}[${i}]`, out));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      collectStrings(v, path ? `${path}.${k}` : k, out);
    }
  }
}

/** Reports where a secret-looking string appears. Never echoes the value. */
export function scanGraphForSecrets(
  graph: LangGraphAbstraction,
): SecretWarning[] {
  const warnings: SecretWarning[] = [];
  for (const node of graph.nodes) {
    const strings: { field: string; text: string }[] = [];
    collectStrings(node.config, "config", strings);
    for (const { field, text } of strings) {
      if (looksLikeSecret(text)) warnings.push({ nodeId: node.id, field });
    }
  }
  const stateStrings: { field: string; text: string }[] = [];
  collectStrings(graph.stateSchema, "stateSchema", stateStrings);
  for (const { field, text } of stateStrings) {
    if (looksLikeSecret(text)) warnings.push({ nodeId: "(state)", field });
  }
  return warnings;
}
