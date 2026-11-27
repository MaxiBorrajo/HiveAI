/**
 * The Markdown a model writes, read into blocks and styled spans that the
 * Word and PDF builders lay out: headings, paragraphs, bullet and numbered
 * lists, quotes, code blocks, tables, and bold, italic, code and links
 * inside the text.
 */

export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullet"; text: string }
  | { type: "numbered"; number: string; text: string }
  | { type: "quote"; text: string }
  | { type: "code"; lines: string[] }
  | { type: "table"; rows: string[][] };

const INLINE = /\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(text: string, base: Omit<Span, "text"> = {}): Span[] {
  const spans: Span[] = [];
  const push = (part: string, style: Omit<Span, "text"> = {}) => {
    if (part) spans.push({ text: part, ...base, ...style });
  };
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    push(text.slice(last, match.index));
    const [, bold, italic, code, linkText, url] = match;
    if (bold !== undefined) push(bold, { bold: true });
    else if (italic !== undefined) push(italic, { italic: true });
    else if (code !== undefined) push(code, { code: true });
    else push(`${linkText} (${url})`);
    last = match.index + match[0].length;
  }
  push(text.slice(last));
  return spans;
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

export function parseMarkdown(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let text: string[] = [];
  const flush = () => {
    if (text.length > 0) blocks.push({ type: "paragraph", text: text.join(" ") });
    text = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match: RegExpExecArray | null;
    if (/^\s*```/.test(line)) {
      flush();
      const code: string[] = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
      blocks.push({ type: "code", lines: code });
    } else if ((match = /^(#{1,6})\s+(.*)$/.exec(line))) {
      flush();
      blocks.push({ type: "heading", level: Math.min(match[1].length, 3), text: match[2] });
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
    } else if ((match = /^\s*[-*+]\s+(.*)$/.exec(line))) {
      flush();
      blocks.push({ type: "bullet", text: match[1] });
    } else if ((match = /^\s*(\d+)[.)]\s+(.*)$/.exec(line))) {
      flush();
      blocks.push({ type: "numbered", number: match[1], text: match[2] });
    } else if ((match = /^>\s?(.*)$/.exec(line))) {
      flush();
      blocks.push({ type: "quote", text: match[1] });
    } else if (line.trim().startsWith("|")) {
      flush();
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].trim().startsWith("|"); i++) {
        if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i])) rows.push(splitRow(lines[i]));
      }
      i--;
      if (rows.length > 0) blocks.push({ type: "table", rows });
    } else if (!line.trim()) {
      flush();
    } else {
      text.push(line.trim());
    }
  }
  flush();
  return blocks;
}
