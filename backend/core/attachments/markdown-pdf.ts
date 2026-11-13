import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import { parseInline, parseMarkdown, type Block, type Span } from "./markdown-blocks.ts";

/**
 * Turns the Markdown a model writes into a PDF, laid out here with the
 * standard PDF fonts: nothing to download or install, so it works offline.
 */

// A4 with 2.5cm margins, in points.
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 70.87;
const TEXT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const BODY_SIZE = 11;
const CODE_SIZE = 9.5;
const LINE_SPACING = 1.4;
const HEADING_SIZES: Record<number, number> = { 1: 18, 2: 15, 3: 13 };
const LIST_INDENT = 20;
const CELL_PADDING = 4;
const TEXT_COLOR = rgb(0.1, 0.1, 0.1);
const MUTED_COLOR = rgb(0.35, 0.35, 0.35);
const BORDER_COLOR = rgb(0.6, 0.6, 0.6);
const SHADE_COLOR = rgb(0.94, 0.94, 0.94);

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
  code: PDFFont;
}

interface Piece {
  text: string;
  font: PDFFont;
}

type Line = Piece[];

function fontFor(fonts: Fonts, span: Omit<Span, "text">): PDFFont {
  if (span.code) return fonts.code;
  if (span.bold && span.italic) return fonts.boldItalic;
  if (span.bold) return fonts.bold;
  if (span.italic) return fonts.italic;
  return fonts.regular;
}

/**
 * The standard fonts only cover Western European characters: an accented
 * letter outside them loses its accent, and anything else (emoji) is left out.
 */
function printable(font: PDFFont, text: string): string {
  const fits = (char: string) => {
    try {
      font.encodeText(char);
      return true;
    } catch {
      return false;
    }
  };
  let out = "";
  for (const char of text.replace(/\t/g, "    ").replace(/[\u0000-\u001F]/g, "")) {
    if (fits(char)) out += char;
    else {
      const plain = char.normalize("NFKD").replace(/\p{M}/gu, "");
      if (plain && [...plain].every(fits)) out += plain;
    }
  }
  return out;
}

/** Splits text into lines that fit `width`; words too long are cut. */
function wrap(fonts: Fonts, spans: Span[], width: number, size: number): Line[] {
  const lines: Line[] = [];
  let line: Line = [];
  let lineWidth = 0;
  let space: Piece | undefined;
  const breakLine = () => {
    lines.push(line);
    line = [];
    lineWidth = 0;
    space = undefined;
  };
  const add = (piece: Piece, pieceWidth: number) => {
    line.push(piece);
    lineWidth += pieceWidth;
  };

  for (const span of spans) {
    const font = fontFor(fonts, span);
    const measure = (text: string) => font.widthOfTextAtSize(text, size);
    for (const token of printable(font, span.text).split(/(\s+)/)) {
      if (!token) continue;
      if (/^\s+$/.test(token)) {
        if (line.length > 0) space = { text: " ", font };
        continue;
      }
      let word = token;
      while (word) {
        const spaceWidth = space ? measure(space.text) : 0;
        const wordWidth = measure(word);
        if (lineWidth + spaceWidth + wordWidth <= width) {
          if (space) add(space, spaceWidth);
          add({ text: word, font }, wordWidth);
          space = undefined;
          break;
        }
        if (line.length > 0) {
          breakLine();
          continue;
        }
        // Alone on its line and still too long: cut it where it overflows.
        let cut = 1;
        while (cut < word.length && measure(word.slice(0, cut + 1)) <= width) cut++;
        add({ text: word.slice(0, cut), font }, measure(word.slice(0, cut)));
        breakLine();
        word = word.slice(cut);
      }
    }
  }
  if (line.length > 0 || lines.length === 0) lines.push(line);
  return lines;
}

class Layout {
  private page!: PDFPage;
  private y = 0;

  constructor(private doc: PDFDocument, private fonts: Fonts) {
    this.newPage();
  }

  private newPage() {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  private atTop() {
    return this.y === PAGE_HEIGHT - MARGIN;
  }

  /** Starts a new page unless `height` still fits on this one. */
  private ensure(height: number) {
    if (this.y - height < MARGIN && !this.atTop()) this.newPage();
  }

  space(points: number) {
    if (!this.atTop()) this.y -= points;
  }

  private drawLine(line: Line, x: number, baseline: number, size: number, color = TEXT_COLOR) {
    for (const piece of line) {
      this.page.drawText(piece.text, { x, y: baseline, size, font: piece.font, color });
      x += piece.font.widthOfTextAtSize(piece.text, size);
    }
  }

  text(
    spans: Span[],
    { indent = 0, size = BODY_SIZE, color = TEXT_COLOR, marker, keepWithNext = 0 }: {
      indent?: number;
      size?: number;
      color?: typeof TEXT_COLOR;
      marker?: string;
      keepWithNext?: number;
    } = {},
  ) {
    const height = size * LINE_SPACING;
    const lines = wrap(this.fonts, spans, TEXT_WIDTH - indent, size);
    lines.forEach((line, i) => {
      this.ensure(height + (i === 0 ? keepWithNext : 0));
      const baseline = this.y - size;
      if (i === 0 && marker) {
        this.drawLine([{ text: marker, font: this.fonts.regular }], MARGIN + indent - LIST_INDENT + 4, baseline, size, color);
      }
      this.drawLine(line, MARGIN + indent, baseline, size, color);
      this.y -= height;
    });
  }

  code(lines: string[]) {
    const height = CODE_SIZE * LINE_SPACING;
    for (const source of lines) {
      for (const line of wrap(this.fonts, [{ text: source || " ", code: true }], TEXT_WIDTH - 8, CODE_SIZE)) {
        this.ensure(height);
        this.page.drawRectangle({ x: MARGIN, y: this.y - height, width: TEXT_WIDTH, height, color: SHADE_COLOR });
        this.drawLine(line, MARGIN + 4, this.y - CODE_SIZE - 1, CODE_SIZE);
        this.y -= height;
      }
    }
  }

  table(rows: string[][]) {
    const columns = Math.max(...rows.map((row) => row.length));
    const cellWidth = TEXT_WIDTH / columns;
    const height = BODY_SIZE * LINE_SPACING;
    rows.forEach((row, r) => {
      const cells = Array.from({ length: columns }, (_, c) =>
        wrap(this.fonts, parseInline(row[c] ?? "", { bold: r === 0 }), cellWidth - 2 * CELL_PADDING, BODY_SIZE)
      );
      const rowHeight = Math.max(...cells.map((lines) => lines.length)) * height + 2 * CELL_PADDING;
      this.ensure(rowHeight);
      cells.forEach((lines, c) => {
        const x = MARGIN + c * cellWidth;
        this.page.drawRectangle({
          x,
          y: this.y - rowHeight,
          width: cellWidth,
          height: rowHeight,
          borderColor: BORDER_COLOR,
          borderWidth: 0.5,
          ...(r === 0 ? { color: SHADE_COLOR } : {}),
        });
        lines.forEach((line, i) => {
          this.drawLine(line, x + CELL_PADDING, this.y - CELL_PADDING - i * height - BODY_SIZE, BODY_SIZE);
        });
      });
      this.y -= rowHeight;
    });
  }
}

function drawBlock(layout: Layout, block: Block) {
  switch (block.type) {
    case "heading": {
      const size = HEADING_SIZES[block.level];
      layout.space(size * 0.6);
      // A heading never ends a page with nothing under it.
      layout.text(parseInline(block.text, { bold: true }), { size, keepWithNext: BODY_SIZE * 3 });
      layout.space(4);
      return;
    }
    case "paragraph":
      layout.text(parseInline(block.text));
      layout.space(6);
      return;
    case "bullet":
      layout.text(parseInline(block.text), { indent: LIST_INDENT, marker: "•" });
      layout.space(2);
      return;
    case "numbered":
      layout.text(parseInline(block.text), { indent: LIST_INDENT, marker: `${block.number}.` });
      layout.space(2);
      return;
    case "quote":
      layout.text(parseInline(block.text, { italic: true }), { indent: LIST_INDENT, color: MUTED_COLOR });
      layout.space(6);
      return;
    case "code":
      layout.code(block.lines);
      layout.space(8);
      return;
    case "table":
      layout.table(block.rows);
      layout.space(8);
      return;
  }
}

export async function markdownToPdf(markdown: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
    code: await doc.embedFont(StandardFonts.Courier),
  };
  const blocks = parseMarkdown(markdown);
  const title = blocks.find((block) => block.type === "heading");
  if (title?.type === "heading") doc.setTitle(printable(fonts.regular, title.text));
  doc.setProducer("HiveAI");

  const layout = new Layout(doc, fonts);
  for (const block of blocks) drawBlock(layout, block);
  return await doc.save();
}
