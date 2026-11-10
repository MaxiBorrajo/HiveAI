import { TextWriter, Uint8ArrayReader, ZipReader } from "@zip-js/zip-js";

// A few MB of zipped XML can expand a lot: refuse to inflate past this.
const MAX_XML_BYTES = 50 * 1024 * 1024;

const WORD_DOCUMENT = "word/document.xml";
const SLIDE_PATH = /^ppt\/slides\/slide(\d+)\.xml$/;

const WORD_TOKEN =
  /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br(?:\s[^>]*)?\/>|<w:tc(?:\s[^>]*)?>|<\/w:p>|<\/w:tc>|<\/w:tr>/g;
const SLIDE_TOKEN = /<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>|<a:br[\s/>]|<\/a:p>/g;

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXml(text: string): string {
  return text.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi,
    (_, decimal, hex, name) =>
      decimal
        ? String.fromCodePoint(Number(decimal))
        : hex
        ? String.fromCodePoint(parseInt(hex, 16))
        : XML_ENTITIES[name.toLowerCase()],
  );
}

async function readZipTexts(
  bytes: Uint8Array,
  wanted: (path: string) => boolean,
): Promise<Map<string, string>> {
  const reader = new ZipReader(new Uint8ArrayReader(bytes), {
    useWebWorkers: false,
  });
  try {
    const texts = new Map<string, string>();
    let inflated = 0;
    for (const entry of await reader.getEntries()) {
      if (entry.directory || !wanted(entry.filename)) continue;
      inflated += entry.uncompressedSize;
      if (inflated > MAX_XML_BYTES) throw new Error("the document is too large");
      texts.set(entry.filename, await entry.getData(new TextWriter()));
    }
    return texts;
  } finally {
    await reader.close();
  }
}

function wordXmlToText(xml: string): string {
  let out = "";
  let inCell = false;
  for (const match of xml.matchAll(WORD_TOKEN)) {
    const token = match[0];
    if (match[1] !== undefined) out += decodeXml(match[1]);
    else if (token === "<w:tab/>") out += "\t";
    else if (token.startsWith("<w:br")) out += "\n";
    else if (token.startsWith("<w:tc")) inCell = true;
    else if (token === "</w:p>") out += inCell ? " " : "\n";
    else if (token === "</w:tc>") {
      inCell = false;
      out = `${out.trimEnd()} | `;
    } else out = out.replace(/ \| $/, "\n");
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

function slideXmlToText(xml: string): string {
  let out = "";
  for (const match of xml.matchAll(SLIDE_TOKEN)) {
    out += match[1] !== undefined ? decodeXml(match[1]) : "\n";
  }
  return out.replace(/\n{2,}/g, "\n").trim();
}

function requireText(text: string): string {
  if (!text) throw new Error("the document has no text to extract");
  return text;
}

export async function extractTextFromDocx(bytes: Uint8Array): Promise<string> {
  const xml = (await readZipTexts(bytes, (p) => p === WORD_DOCUMENT))
    .get(WORD_DOCUMENT);
  if (xml === undefined) throw new Error("it is not a valid Word document");
  return requireText(wordXmlToText(xml));
}

export async function extractTextFromPptx(bytes: Uint8Array): Promise<string> {
  const slides = await readZipTexts(bytes, (p) => SLIDE_PATH.test(p));
  if (slides.size === 0) throw new Error("it is not a valid PowerPoint file");

  const slideNumber = (path: string) => Number(SLIDE_PATH.exec(path)![1]);
  const sections = [...slides.keys()]
    .sort((a, b) => slideNumber(a) - slideNumber(b))
    .map((path) => ({
      number: slideNumber(path),
      text: slideXmlToText(slides.get(path)!),
    }))
    .filter((slide) => slide.text);
  return requireText(
    sections.map((s) => `--- Slide ${s.number} ---\n${s.text}`).join("\n\n"),
  );
}
