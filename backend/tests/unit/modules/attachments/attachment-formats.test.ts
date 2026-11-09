import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip-js/zip-js";
import * as XLSX from "xlsx";
import { AppError } from "../../../../core/api/errors.ts";
import { MAX_TOTAL_CONTEXT_CHARS } from "../../../../core/attachments/attachment-limits.ts";
import { buildAttachmentContent } from "../../../../core/attachments/build-attachment-content.ts";
import type { TextContentPart } from "../../../../core/attachments/build-attachment-content.ts";
import { initORM } from "../../../../infrastructure/db/orm.ts";
import { AttachmentRepository } from "../../../../infrastructure/db/repositories/attachment-repository.ts";
import { createAttachment } from "../../../../modules/attachments/use-cases/create-attachment.ts";

const visionModel = { provider: "anthropic", model: "claude-test" } as never;

async function setup() {
  const dataDir = await Deno.makeTempDir();
  const repo = new AttachmentRepository(await initORM(dataDir));
  const upload = (name: string, content: BlobPart, type = "") =>
    createAttachment(
      { repo, dataDir },
      new File([content], name, { type }),
      "input",
      {},
    );
  const textFor = async (ids: number[]) => {
    const { parts, warnings } = await buildAttachmentContent(
      dataDir,
      repo,
      ids,
      visionModel,
      MAX_TOTAL_CONTEXT_CHARS,
    );
    return { texts: parts.map((p) => (p as TextContentPart).text), parts, warnings };
  };
  return { dataDir, repo, upload, textFor };
}

async function zip(files: Record<string, string>): Promise<BlobPart> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  for (const [path, content] of Object.entries(files)) {
    await writer.add(path, new TextReader(content));
  }
  return (await writer.close()) as BlobPart;
}

const WORD_BODY = `<w:document><w:body>
  <w:p><w:pPr><w:tabs><w:tab w:val="left"/></w:tabs></w:pPr><w:r><w:t>Tom &amp; Jerry</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">contract</w:t></w:r></w:p>
  <w:tbl>
    <w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>Item</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Price</w:t></w:r></w:p></w:tc></w:tr>
    <w:tr><w:tc><w:p><w:r><w:t>Book</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>10</w:t></w:r></w:p></w:tc></w:tr>
  </w:tbl>
  <w:p><w:r><w:delText>removed</w:delText></w:r><w:r><w:t>Closing</w:t></w:r></w:p>
</w:body></w:document>`;

const slide = (...lines: string[]) =>
  `<p:sld>${lines.map((l) => `<a:p><a:r><a:t>${l}</a:t></a:r></a:p>`).join("")}</p:sld>`;

// One page with the text "Hello PDF"; pdf.js rebuilds the omitted xref table.
const PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 41>>stream
BT /F1 18 Tf 20 100 Td (Hello PDF) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>`;

Deno.test("plain text formats reach the model as they are", async () => {
  const { upload, textFor } = await setup();
  for (const [name, content] of [
    ["a.txt", "plain body"],
    ["a.md", "# markdown body"],
    ["a.csv", "x,y\n1,2"],
    ["a.json", '{"key":"value"}'],
  ]) {
    const { id } = await upload(name, content);
    assertStringIncludes((await textFor([id])).texts[0], content);
  }
});

Deno.test("the file extension wins over the type the browser reports", async () => {
  const { upload } = await setup();
  assertEquals((await upload("notes.md", "x", "")).mimeType, "text/markdown");
  assertEquals(
    (await upload("data.csv", "a,b", "application/vnd.ms-excel")).mimeType,
    "text/csv",
  );
});

Deno.test("PDF - its text layer reaches the model", async () => {
  const { upload, textFor } = await setup();
  const { id } = await upload("a.pdf", PDF);
  assertStringIncludes((await textFor([id])).texts[0], "Hello PDF");
});

Deno.test("XLSX - every sheet reaches the model as CSV", async () => {
  const { upload, textFor } = await setup();
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["a", "b"], [1, 2]]), "Data");
  const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const { id } = await upload("a.xlsx", bytes);
  const [text] = (await textFor([id])).texts;
  assertStringIncludes(text, "--- Sheet: Data ---");
  assertStringIncludes(text, "a,b\n1,2");
});

Deno.test("DOCX - paragraphs and tables reach the model, deleted text does not", async () => {
  const { upload, textFor } = await setup();
  const { id } = await upload("a.docx", await zip({ "word/document.xml": WORD_BODY }));
  const [text] = (await textFor([id])).texts;
  assertStringIncludes(text, "Tom & Jerry\tcontract");
  assertStringIncludes(text, "Item | Price\nBook | 10");
  assertStringIncludes(text, "Closing");
  assert(!text.includes("removed"));
});

Deno.test("PPTX - slides reach the model in numeric order", async () => {
  const { upload, textFor } = await setup();
  const { id } = await upload(
    "a.pptx",
    await zip({
      "ppt/slides/slide10.xml": slide("Last"),
      "ppt/slides/slide2.xml": slide("Title", "Bullet"),
    }),
  );
  const [text] = (await textFor([id])).texts;
  assertStringIncludes(text, "--- Slide 2 ---\nTitle\nBullet\n\n--- Slide 10 ---\nLast");
});

Deno.test("an image becomes an image part on a vision model", async () => {
  const { upload, textFor } = await setup();
  const { id } = await upload("a.png", new Uint8Array([1, 2, 3]));
  assertEquals((await textFor([id])).parts, [
    { type: "image", mimeType: "image/png", data: "AQID" },
  ]);
});

Deno.test("an unsupported format is rejected naming the supported ones", async () => {
  const { upload } = await setup();
  const error = await assertRejects(() => upload("a.exe", "x"), AppError);
  assertEquals(error.status, 415);
  assertStringIncludes(error.message, "Word (.docx)");
});

Deno.test("a damaged or textless document is rejected and leaves no file behind", async () => {
  const { dataDir, upload } = await setup();
  await assertRejects(() => upload("a.docx", "not a zip"), AppError);
  const textless = await zip({ "word/document.xml": "<w:document/>" });
  const error = await assertRejects(() => upload("b.docx", textless), AppError);
  assertStringIncludes(error.message, "no text to extract");
  const stored = [...Deno.readDirSync(`${dataDir}/attachments`)];
  assertEquals(stored, []);
});

Deno.test("text over the budget is cut, marked for the model and reported to the user", async () => {
  const { upload, textFor } = await setup();
  const first = await upload("big.txt", "a".repeat(MAX_TOTAL_CONTEXT_CHARS + 10));
  const second = await upload("next.txt", "b");

  const { texts, warnings } = await textFor([first.id, second.id]);

  assertEquals(texts.length, 1);
  assertStringIncludes(texts[0], "file truncated");
  assertEquals(warnings.length, 2);
  assertStringIncludes(warnings[0], "'big.txt' was cut");
  assertStringIncludes(warnings[1], "'next.txt' was left out");
});
