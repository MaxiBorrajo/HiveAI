import {
  TextWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
} from "@zip-js/zip-js";
import { scanMarker, type ExtractedDocument, type ScanSource } from "./scanned-content.ts";

// A few MB of zipped XML can expand a lot: refuse to inflate past this.
const MAX_XML_BYTES = 50 * 1024 * 1024;

const WORD_DOCUMENT = "word/document.xml";
const SLIDE_PATH = /^ppt\/slides\/slide(\d+)\.xml$/;
// Formats Tesseract and every vision model read; drawings like EMF are skipped.
const IMAGE_PATH = /^(?:word|ppt)\/media\/[^/]*?(\d*)\.(png|jpe?g)$/i;
export const MAX_DOCUMENT_IMAGES = 20;

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
): Promise<{ texts: Map<string, string>; images: ScanSource[] }> {
  const reader = new ZipReader(new Uint8ArrayReader(bytes), {
    useWebWorkers: false,
  });
  try {
    const texts = new Map<string, string>();
    const imagePaths: string[] = [];
    let inflated = 0;
    for (const entry of await reader.getEntries()) {
      if (entry.directory) continue;
      if (IMAGE_PATH.test(entry.filename)) imagePaths.push(entry.filename);
      if (!wanted(entry.filename)) continue;
      inflated += entry.uncompressedSize;
      if (inflated > MAX_XML_BYTES) throw new Error("the document is too large");
      texts.set(entry.filename, await entry.getData(new TextWriter()));
    }
    return { texts, images: imageSources(imagePaths) };
  } finally {
    await reader.close();
  }
}

function imageSources(paths: string[]): ScanSource[] {
  const order = (path: string) => Number(IMAGE_PATH.exec(path)![1] || 0);
  return paths
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    .slice(0, MAX_DOCUMENT_IMAGES)
    .map((path, i) => ({
      key: `m${i + 1}`,
      label: `Image ${path.slice(path.lastIndexOf("/") + 1)}`,
      mediaPath: path,
      mimeType: IMAGE_PATH.exec(path)![2].toLowerCase() === "png"
        ? "image/png"
        : "image/jpeg",
    }));
}

export async function readZipEntry(
  bytes: Uint8Array,
  path: string,
): Promise<Uint8Array> {
  const reader = new ZipReader(new Uint8ArrayReader(bytes), {
    useWebWorkers: false,
  });
  try {
    const entry = (await reader.getEntries()).find((e) => e.filename === path);
    if (!entry || entry.directory) throw new Error(`'${path}' is not in the document`);
    return await entry.getData(new Uint8ArrayWriter());
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

/** Images go last, each with a marker where OCR text will go. */
function withImages(text: string, images: ScanSource[]): ExtractedDocument {
  if (!text && images.length === 0) {
    throw new Error("the document has no text or images to read");
  }
  if (images.length === 0) return { text, sources: [] };
  const markers = images.map((image) => scanMarker(image.key)).join("\n\n");
  return {
    text: `${text}\n\n--- Images in the document ---\n${markers}`.trimStart(),
    sources: images,
  };
}

export async function extractTextFromDocx(
  bytes: Uint8Array,
): Promise<ExtractedDocument> {
  const { texts, images } = await readZipTexts(bytes, (p) => p === WORD_DOCUMENT);
  const xml = texts.get(WORD_DOCUMENT);
  if (xml === undefined) throw new Error("it is not a valid Word document");
  return withImages(wordXmlToText(xml), images);
}

export async function extractTextFromPptx(
  bytes: Uint8Array,
): Promise<ExtractedDocument> {
  const { texts: slides, images } = await readZipTexts(bytes, (p) => SLIDE_PATH.test(p));
  if (slides.size === 0) throw new Error("it is not a valid PowerPoint file");

  const slideNumber = (path: string) => Number(SLIDE_PATH.exec(path)![1]);
  const sections = [...slides.keys()]
    .sort((a, b) => slideNumber(a) - slideNumber(b))
    .map((path) => ({
      number: slideNumber(path),
      text: slideXmlToText(slides.get(path)!),
    }))
    .filter((slide) => slide.text);
  return withImages(
    sections.map((s) => `--- Slide ${s.number} ---\n${s.text}`).join("\n\n"),
    images,
  );
}
