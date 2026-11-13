import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip-js/zip-js";
import { parseInline, parseMarkdown, type Block, type Span } from "./markdown-blocks.ts";

/** Turns the Markdown a model writes into a Word document. */

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

// XML 1.0 forbids these control characters even when escaped.
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

function escapeXml(text: string): string {
  return text
    .replace(INVALID_XML_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function run({ text, bold, italic, code }: Span): string {
  if (!text) return "";
  const props = (bold ? "<w:b/>" : "") +
    (italic ? "<w:i/>" : "") +
    (code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : "");
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function runs(text: string, base: Omit<Span, "text"> = {}): string {
  return parseInline(text, base).map(run).join("");
}

function paragraph(content: string, props = ""): string {
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${content}</w:p>`;
}

const style = (id: string) => `<w:pStyle w:val="${id}"/>`;
const indent = '<w:ind w:left="720" w:hanging="360"/>';

function table(rows: string[][]): string {
  const columns = Math.max(...rows.map((row) => row.length));
  const borders = ["top", "left", "bottom", "right", "insideH", "insideV"]
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`)
    .join("");
  const grid = `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(columns)}</w:tblGrid>`;
  const body = rows.map((row, r) => {
    const cells = [...row, ...Array(columns - row.length).fill("")];
    return `<w:tr>${cells.map((cell) => `<w:tc>${paragraph(runs(cell, { bold: r === 0 }))}</w:tc>`).join("")}</w:tr>`;
  }).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${borders}</w:tblBorders></w:tblPr>${grid}${body}</w:tbl>`;
}

function blockXml(block: Block): string {
  switch (block.type) {
    case "heading":
      return paragraph(runs(block.text), style(`Heading${block.level}`));
    case "paragraph":
      return paragraph(runs(block.text));
    case "bullet":
      return paragraph(run({ text: "•\t" }) + runs(block.text), indent);
    case "numbered":
      return paragraph(run({ text: `${block.number}.\t` }) + runs(block.text), indent);
    case "quote":
      return paragraph(runs(block.text, { italic: true }), '<w:ind w:left="720"/>');
    case "code":
      return block.lines
        .map((line) => paragraph(run({ text: line || " ", code: true }), style("Code")))
        .join("") + paragraph("");
    case "table":
      return table(block.rows) + paragraph("");
  }
}

function markdownToBody(markdown: string): string {
  return parseMarkdown(markdown).map(blockXml).join("") || paragraph("");
}

const heading = (level: number, size: number) =>
  `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;

const STYLES = `${XML_HEADER}<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${heading(1, 32)}${heading(2, 28)}${heading(3, 24)}<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr></w:style></w:styles>`;

const CONTENT_TYPES = `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;

const PACKAGE_RELS = `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const DOCUMENT_RELS = `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

// A4 with 2.5cm margins.
const SECTION = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';

export async function markdownToDocx(markdown: string): Promise<Uint8Array> {
  const document = `${XML_HEADER}<w:document ${W}><w:body>${markdownToBody(markdown)}${SECTION}</w:body></w:document>`;
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  await writer.add("[Content_Types].xml", new TextReader(CONTENT_TYPES));
  await writer.add("_rels/.rels", new TextReader(PACKAGE_RELS));
  await writer.add("word/document.xml", new TextReader(document));
  await writer.add("word/_rels/document.xml.rels", new TextReader(DOCUMENT_RELS));
  await writer.add("word/styles.xml", new TextReader(STYLES));
  return await writer.close();
}
