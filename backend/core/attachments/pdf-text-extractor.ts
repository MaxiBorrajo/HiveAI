import { extractImages, extractText, getDocumentProxy } from "unpdf";
import { scanMarker, type ExtractedDocument, type ScanSource } from "./scanned-content.ts";

type PDFDocumentProxy = Awaited<ReturnType<typeof getDocumentProxy>>;

// Below this a page has no real text layer: at most a page number or a stamp.
const MIN_PAGE_TEXT_CHARS = 25;

async function paintsImages(pdf: PDFDocumentProxy, page: number): Promise<boolean> {
  try {
    return (await extractImages(pdf, page)).length > 0;
  } catch {
    // Unreadable images are still images: let OCR try the rendered page.
    return true;
  }
}

/**
 * Reads the text layer page by page. A page with almost no text but with an
 * image is a scan: it gets a marker where OCR text will go. Blank pages don't.
 */
export async function extractTextFromPdf(
  bytes: Uint8Array,
): Promise<ExtractedDocument> {
  // pdf.js takes ownership of the buffer it is given.
  const pdf = await getDocumentProxy(bytes.slice());
  const { text: pages } = await extractText(pdf, { mergePages: false });

  const sections: string[] = [];
  const sources: ScanSource[] = [];
  for (let i = 0; i < pages.length; i++) {
    const page = i + 1;
    const text = pages[i].trim();
    if (text.length < MIN_PAGE_TEXT_CHARS && await paintsImages(pdf, page)) {
      const key = `p${page}`;
      sources.push({ key, label: `Page ${page}`, page });
      sections.push(text ? `${text}\n${scanMarker(key)}` : scanMarker(key));
    } else if (text) {
      sections.push(text);
    }
  }
  return { text: sections.join("\n\n"), sources };
}
