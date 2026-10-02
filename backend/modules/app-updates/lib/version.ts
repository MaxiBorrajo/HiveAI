function parse(version: string): number[] {
  return version.replace(/^v/, "").split(".").map((part) => parseInt(part, 10) || 0);
}

export function isNewerVersion(current: string, latest: string): boolean {
  const a = parse(current);
  const b = parse(latest);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}
