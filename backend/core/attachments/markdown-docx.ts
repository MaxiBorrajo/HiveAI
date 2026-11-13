import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip-js/zip-js";

/**
 * Turns the Markdown a model writes into a Word document: headings,
 * paragraphs, bullet and numbered lists, quotes, code blocks, tables, and
 * bold, italic, code and links inside the text.
 */

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

// XML 1.0 forbids these control characters even when escaped.
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
const INLINE = /\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

interface RunStyle {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

function escapeXml(text: string): string {
  return text
    .replace(INVALID_XML_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function run(text: string, style: RunStyle = {}): string {
  if (!text) return "";
  const props = (style.bold ? "<w:b/>" : "") +
    (style.italic ? "<w:i/>" : "") +
    (style.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : "");
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function runs(text: string, base: RunStyle = {}): string {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    out += run(text.slice(last, match.index), base);
    const [, bold, italic, code, linkText, url] = match;
    if (bold !== undefined) out += run(bold, { ...base, bold: true });
    else if (italic !== undefined) out += run(italic, { ...base, italic: true });
    else if (code !== undefined) out += run(code, { ...base, code: true });
    else out += run(`${linkText} (${url})`, base);
    last = match.index + match[0].length;
  }
  return out + run(text.slice(last), base);
}

function paragraph(content: string, props = ""): string {
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${content}</w:p>`;
}

const style = (id: string) => `<w:pStyle w:val="${id}"/>`;
const indent = '<w:ind w:left="720" w:hanging="360"/>';

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

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

function markdownToBody(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const body: string[] = [];
  let text: string[] = [];
  const flush = () => {
    if (text.length > 0) body.push(paragraph(runs(text.join(" "))));
    text = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match: RegExpExecArray | null;
    if (/^\s*```/.test(line)) {
      flush();
      while (++i < lines.length && !/^\s*```/.test(lines[i])) {
        body.push(paragraph(run(lines[i] || " ", { code: true }), style("Code")));
      }
      body.push(paragraph(""));
    } else if ((match = /^(#{1,6})\s+(.*)$/.exec(line))) {
      flush();
      body.push(paragraph(runs(match[2]), style(`Heading${Math.min(match[1].length, 3)}`)));
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
    } else if ((match = /^\s*[-*+]\s+(.*)$/.exec(line))) {
      flush();
      body.push(paragraph(run("•\t") + runs(match[1]), indent));
    } else if ((match = /^\s*(\d+)[.)]\s+(.*)$/.exec(line))) {
      flush();
      body.push(paragraph(run(`${match[1]}.\t`) + runs(match[2]), indent));
    } else if ((match = /^>\s?(.*)$/.exec(line))) {
      flush();
      body.push(paragraph(runs(match[1], { italic: true }), '<w:ind w:left="720"/>'));
    } else if (line.trim().startsWith("|")) {
      flush();
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].trim().startsWith("|"); i++) {
        if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i])) rows.push(splitRow(lines[i]));
      }
      i--;
      if (rows.length > 0) body.push(table(rows), paragraph(""));
    } else if (!line.trim()) {
      flush();
    } else {
      text.push(line.trim());
    }
  }
  flush();
  return body.join("") || paragraph("");
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
