import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip-js/zip-js";
import { initORM } from "../../../../infrastructure/db/orm.ts";
import { AttachmentRepository } from "../../../../infrastructure/db/repositories/attachment-repository.ts";
import { createAttachment } from "../../../../modules/attachments/use-cases/create-attachment.ts";
import {
  attachmentText,
  buildAttachmentContent,
  type TextContentPart,
} from "../../../../core/attachments/build-attachment-content.ts";
import { extractTextFromPdf } from "../../../../core/attachments/pdf-text-extractor.ts";
import {
  recognizeAttachment,
  type WithOcrEngine,
} from "../../../../core/attachments/scan-recognition.ts";
import { indexAttachment } from "../../../../core/attachments/attachment-index.ts";

type PageKind = "text" | "scan" | "blank";

/** A PDF whose "scan" pages only paint an image, like a scanner's output. */
function pdf(pages: PageKind[]): Uint8Array {
  const objects: string[] = [];
  objects[1] = "<</Type/Catalog/Pages 2 0 R>>";
  objects[2] = `<</Type/Pages/Kids[${pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ")}]/Count ${pages.length}>>`;
  objects[3] = "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>";
  objects[4] =
    "<</Type/XObject/Subtype/Image/Width 2/Height 2/ColorSpace/DeviceGray/BitsPerComponent 8/Length 4>>stream\n\x00\xff\xff\x00\nendstream";
  pages.forEach((kind, i) => {
    const page = 5 + i * 2;
    const content = kind === "text"
      ? `BT /F1 10 Tf 10 100 Td (Page ${i + 1} has a real text layer to read) Tj ET`
      : kind === "scan"
      ? "q 300 0 0 144 0 0 cm /Im1 Do Q"
      : "";
    objects[page] =
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents ${page + 1} 0 R/Resources<</Font<</F1 3 0 R>>/XObject<</Im1 4 0 R>>>>>>`;
    objects[page + 1] = `<</Length ${content.length}>>stream\n${content}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, n) => {
    offsets[n] = out.length;
    out += `${n} 0 obj${object}endobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objects.length; n++) {
    out += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer<</Size ${objects.length}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0));
}

async function docx(text: string, images: string[]): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  const body = text ? `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` : "";
  await writer.add("word/document.xml", new TextReader(`<w:document><w:body>${body}</w:body></w:document>`));
  for (const name of images) {
    await writer.add(`word/media/${name}`, new Uint8ArrayReader(new Uint8Array([1, 2, 3])));
  }
  await writer.add("word/media/drawing.emf", new TextReader("vector"));
  return await writer.close();
}

const reads = (texts: string[]): WithOcrEngine => async (_dataDir, use) => {
  let next = 0;
  return await use((image) => {
    assert(image.length > 0, "the engine gets a real image");
    return Promise.resolve(texts[next++] ?? "");
  });
};
const cannotStart: WithOcrEngine = () =>
  Promise.reject(new Error("no language data and no internet"));

const textModel = { provider: "ollama", model: "text-only" } as never;
const visionModel = { provider: "anthropic", model: "claude-test" } as never;

async function setup() {
  const dataDir = await Deno.makeTempDir();
  const repo = new AttachmentRepository(await initORM(dataDir));
  const scheduled = { recognition: [] as number[], indexing: [] as number[] };
  const upload = (name: string, bytes: Uint8Array) =>
    createAttachment(
      {
        repo,
        dataDir,
        scheduleRecognition: (id) => scheduled.recognition.push(id),
        scheduleIndexing: (id) => scheduled.indexing.push(id),
      },
      new File([bytes as BlobPart], name),
      "input",
      {},
    );
  const content = (id: number, model = textModel) =>
    buildAttachmentContent(dataDir, repo, [id], model, 100_000);
  return { dataDir, repo, scheduled, upload, content };
}

Deno.test("PDF - scanned pages are found among text and blank pages", async () => {
  const { text, sources } = await extractTextFromPdf(pdf(["text", "scan", "blank", "scan"]));

  assertEquals(sources.map((s) => s.page), [2, 4]);
  assertStringIncludes(text, "Page 1 has a real text layer to read");
  assertEquals(text.match(/⟦scan:/g)?.length, 2);
});

Deno.test("PDF - a document with a text layer goes the usual way", async () => {
  const { upload, scheduled } = await setup();

  const dto = await upload("text.pdf", pdf(["text", "text"]));

  assertEquals(dto.scan, null);
  assertEquals(scheduled, { recognition: [], indexing: [dto.id] });
});

Deno.test("PDF - a scanned document is queued for OCR and shows its progress", async () => {
  const { upload, scheduled } = await setup();

  const dto = await upload("scan.pdf", pdf(["scan", "scan"]));

  assertEquals(dto.scan, { status: "pending", done: 0, total: 2 });
  assertEquals(scheduled, { recognition: [dto.id], indexing: [] });
});

Deno.test("OCR - reads every scanned page into the file's text", async () => {
  const { dataDir, repo, upload } = await setup();
  const { id } = await upload("mixed.pdf", pdf(["text", "scan"]));

  await recognizeAttachment(dataDir, repo, id, reads(["Factura numero 12345"]));

  const row = (await repo.findById(id))!;
  assertEquals(row.scan!.status, "done");
  const text = (await attachmentText(dataDir, row))!;
  assertStringIncludes(text, "Page 1 has a real text layer");
  assertStringIncludes(text, "[Page 2, text read from the image]\nFactura numero 12345");
});

Deno.test("OCR - resumes after a restart without reading pages twice", async () => {
  const { dataDir, repo, upload } = await setup();
  const { id } = await upload("scan.pdf", pdf(["scan", "scan"]));
  const row = (await repo.findById(id))!;
  await repo.updateScan(id, { ...row.scan!, texts: { p1: "first" } });

  await recognizeAttachment(dataDir, repo, id, reads(["second"]));

  assertEquals((await repo.findById(id))!.scan!.texts, { p1: "first", p2: "second" });
});

Deno.test("OCR - an engine that cannot start leaves a clear reason", async () => {
  const { dataDir, repo, upload, content } = await setup();
  const { id } = await upload("scan.pdf", pdf(["scan"]));

  await recognizeAttachment(dataDir, repo, id, cannotStart);

  const scan = (await repo.findById(id))!.scan!;
  assertEquals(scan.status, "failed");
  assertStringIncludes(scan.error!, "no language data");
  const { parts, warnings } = await content(id);
  assertStringIncludes((parts[0] as TextContentPart).text, "[Page 1: an image whose text could not be read]");
  assertStringIncludes(warnings[0], "could not be read (no language data and no internet)");
  assertStringIncludes(warnings[0], "A model with image support can read them");
});

Deno.test("send - without vision, pages not read yet are announced", async () => {
  const { upload, content } = await setup();
  const { id } = await upload("scan.pdf", pdf(["text", "scan"]));

  const { parts, warnings } = await content(id);

  assertStringIncludes((parts[0] as TextContentPart).text, "[Page 2: an image whose text is still being read]");
  assertStringIncludes(warnings[0], "still being read (0 of 1)");
});

Deno.test("send - a vision model gets the scanned pages as images, not their OCR text", async () => {
  const { dataDir, repo, upload, content } = await setup();
  const { id } = await upload("mixed.pdf", pdf(["text", "scan"]));
  await recognizeAttachment(dataDir, repo, id, reads(["OCR TEXT"]));

  const { parts, warnings } = await content(id, visionModel);

  assertEquals(parts.map((p) => p.type), ["text", "image", "text"]);
  assertEquals((parts[0] as TextContentPart).text, "[mixed.pdf: Page 2]");
  assertEquals((parts[1] as { mimeType: string }).mimeType, "image/png");
  const text = (parts[2] as TextContentPart).text;
  assertStringIncludes(text, "Page 1 has a real text layer");
  assertStringIncludes(text, "[Page 2: its image is attached]");
  assert(!text.includes("OCR TEXT"));
  assertEquals(warnings, []);
});

Deno.test("send - past the image limit, the rest of the pages go as OCR text", async () => {
  const { dataDir, repo, upload, content } = await setup();
  const { id } = await upload("long.pdf", pdf(Array(12).fill("scan")));
  await recognizeAttachment(dataDir, repo, id, reads(Array.from({ length: 12 }, (_, i) => `page ${i + 1} words`)));

  const { parts, warnings } = await content(id, visionModel);

  assertEquals(parts.filter((p) => p.type === "image").length, 10);
  assertStringIncludes((parts.at(-1) as TextContentPart).text, "page 12 words");
  assertStringIncludes(warnings[0], "10 of its 12 scanned pages or images went to the model as images");
});

Deno.test("Word - text inside its images is read too, drawings are skipped", async () => {
  const { dataDir, repo, upload } = await setup();
  const dto = await upload("cert.docx", await docx("Certificate for the student", ["image10.png", "image2.jpeg"]));
  assertEquals(dto.scan, { status: "pending", done: 0, total: 2 });

  await recognizeAttachment(dataDir, repo, dto.id, reads(["Universidad Nacional de Quilmes", "Sello"]));

  const text = (await attachmentText(dataDir, (await repo.findById(dto.id))!))!;
  assertStringIncludes(text, "Certificate for the student\n\n--- Images in the document ---");
  assertStringIncludes(text, "[Image image2.jpeg, text read from the image]\nUniversidad Nacional de Quilmes");
  assertStringIncludes(text, "[Image image10.png, text read from the image]\nSello");
});

Deno.test("Word - a document that is only images is accepted", async () => {
  const { upload } = await setup();

  const dto = await upload("poster.docx", await docx("", ["image1.png"]));

  assertEquals(dto.scan?.total, 1);
});

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

Deno.test("image - is queued for OCR on upload", async () => {
  const { upload, scheduled } = await setup();

  const dto = await upload("screenshot.png", png);

  assertEquals(dto.scan, { status: "pending", done: 0, total: 1 });
  assertEquals(scheduled, { recognition: [dto.id], indexing: [] });
});

Deno.test("image - a vision model sees it, not its OCR text", async () => {
  const { dataDir, repo, upload, content } = await setup();
  const { id } = await upload("screenshot.png", png);
  await recognizeAttachment(dataDir, repo, id, reads(["OCR TEXT"]));

  const { parts, warnings } = await content(id, visionModel);

  assertEquals(parts.map((p) => p.type), ["image"]);
  assertEquals(warnings, []);
});

Deno.test("image - without vision, the model gets the text read from it", async () => {
  const { dataDir, repo, upload, content } = await setup();
  const { id } = await upload("screenshot.png", png);
  await recognizeAttachment(dataDir, repo, id, reads(["Total a pagar: $500"]));

  const { parts, warnings } = await content(id);

  assertEquals(parts.length, 1);
  assertStringIncludes((parts[0] as TextContentPart).text, "[Image, text read from the image]\nTotal a pagar: $500");
  assertStringIncludes(warnings[0], "it only gets the text read from it");
});

Deno.test("image - without vision, an image with no text or still being read is refused", async () => {
  const { dataDir, repo, upload, content } = await setup();
  const { id } = await upload("logo.png", png);

  await assertRejects(() => content(id), Error, "still being read");

  await recognizeAttachment(dataDir, repo, id, reads([""]));
  await assertRejects(() => content(id), Error, "no text could be read from it");
});

Deno.test("search - a scanned file is indexed only once OCR read it", async () => {
  const { dataDir, repo, upload } = await setup();
  const { id } = await upload("scan.pdf", pdf(["scan"]));
  const embed = () => Promise.resolve([1, 0]);

  await indexAttachment(dataDir, repo, id, embed);
  assertEquals(await repo.countChunks(id), 0);

  await recognizeAttachment(dataDir, repo, id, reads(["recognized words"]));
  await indexAttachment(dataDir, repo, id, embed);
  assertEquals((await repo.findChunks([id]))[0].text, "[Page 1, text read from the image]\nrecognized words");
});
