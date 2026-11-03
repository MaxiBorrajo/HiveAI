const MAX_README_CHARS = 20_000;
const SUMMARY_CHARS = 600;

function stripFrontMatter(markdown: string): string {
  return markdown
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
}

function stripHtml(markdown: string): string {
  return markdown
    .replace(/<[^>]+>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clean(markdown: string): string {
  return stripHtml(stripFrontMatter(markdown));
}

export function cleanReadme(markdown: string): string {
  return clean(markdown).slice(0, MAX_README_CHARS);
}

function linkShare(paragraph: string): number {
  const links = paragraph.match(/\[[^\]]*\]\([^)]*\)/g) ?? [];
  return links.reduce((sum, l) => sum + l.length, 0) / paragraph.length;
}

/** First prose paragraphs of a model card: skips headings, tables, code and link-only lines. */
export function summarizeReadme(markdown: string): string {
  // paragraphs with HTML anchors are navigation ("See our collection…"), not description
  const paragraphs = stripFrontMatter(markdown)
    .split(/\n\s*\n/)
    .filter((p) => !/<a\s/i.test(p))
    .map((p) => stripHtml(p).trim());
  const prose = paragraphs.filter((p) =>
    p.length > 40 && !/^(#|\||```|>|[-*] |\[!)/.test(p) && linkShare(p) < 0.25
  );
  let summary = "";
  for (const p of prose) {
    if (summary && summary.length + p.length > SUMMARY_CHARS) break;
    summary += (summary ? "\n\n" : "") + p;
    if (summary.length >= SUMMARY_CHARS / 2) break;
  }
  return summary.length > SUMMARY_CHARS
    ? summary.slice(0, SUMMARY_CHARS).replace(/\s+\S*$/, "") + "…"
    : summary;
}
