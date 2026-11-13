import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { initORM } from "../../../../infrastructure/db/orm.ts";
import { AttachmentRepository } from "../../../../infrastructure/db/repositories/attachment-repository.ts";
import { ChatRepository } from "../../../../infrastructure/db/repositories/chat-repository.ts";
import { readAttachment } from "../../../../core/attachments/attachment-storage.ts";
import { attachmentText } from "../../../../core/attachments/build-attachment-content.ts";
import { extractTextFromDocx } from "../../../../core/attachments/office-text-extractor.ts";
import { markdownToDocx } from "../../../../core/attachments/markdown-docx.ts";
import {
  createGeneratedFile,
  GeneratedFileError,
  generatedFilesStorage,
  type GeneratedFilesContext,
} from "../../../../core/attachments/generated-files.ts";
import { buildNativeTools } from "../../../../core/ai/strategy/shared/native-tools.ts";

async function setup() {
  const dataDir = await Deno.makeTempDir();
  const db = await initORM(dataDir);
  const chatId = await new ChatRepository(db).create({
    title: "chat",
    createdAt: 1,
    updatedAt: 1,
    messageCount: 0,
  });
  const failures: string[] = [];
  const context: GeneratedFilesContext = {
    dataDir,
    repo: new AttachmentRepository(db),
    chatId,
    files: [],
    onFailure: (message) => failures.push(message),
  };
  const bytesOf = async (storagePath: string) =>
    new TextDecoder().decode(await readAttachment(dataDir, storagePath));
  return { dataDir, context, failures, bytesOf };
}

Deno.test("text formats are saved as written, as output files of the chat", async () => {
  const { context, bytesOf } = await setup();
  const cases = [
    ["notes.md", "# Title\n\nBody", "text/markdown"],
    ["notes.txt", "plain", "text/plain"],
    ["sales.csv", "month,total\njan,10", "text/csv"],
    ["data.json", '{"a": [1, 2]}', "application/json"],
    ["script.py", "print('hola')", "text/plain"],
  ];
  for (const [name, content, mimeType] of cases) {
    const file = await createGeneratedFile(context, name, content);
    assertEquals(
      [file.originalName, file.mimeType, file.direction, file.chatId],
      [name, mimeType, "output", context.chatId],
    );
    assertEquals(await bytesOf(file.storagePath), content);
  }
  assertEquals(context.files.length, cases.length);
});

Deno.test("a Word document is built from Markdown, and its text stays searchable", async () => {
  const { dataDir, context } = await setup();

  const file = await createGeneratedFile(context, "report.docx", "# Report\n\nBody **bold**.");

  assertEquals(file.mimeType, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const { text } = await extractTextFromDocx(await readAttachment(dataDir, file.storagePath));
  assertEquals(text, "Report\nBody bold.");
  assertEquals(await attachmentText(dataDir, file), "# Report\n\nBody **bold**.");
});

Deno.test("markdownToDocx - keeps headings, lists, quotes, code, tables and escapes XML", async () => {
  const markdown = [
    "# Title",
    "First line",
    "continues here with *italic*, `code` and a [link](https://x.org).",
    "",
    "- apple",
    "* pear",
    "1. one",
    "2) two",
    "> quoted",
    "---",
    "```",
    "let a = 1 < 2;",
    "```",
    "| Name | Price |",
    "|------|------:|",
    "| Book & co | <10> |",
    "| Pen |",
  ].join("\n");

  const { text } = await extractTextFromDocx(await markdownToDocx(markdown));

  assertEquals(
    text,
    [
      "Title",
      "First line continues here with italic, code and a link (https://x.org).",
      "•\tapple",
      "•\tpear",
      "1.\tone",
      "2.\ttwo",
      "quoted",
      "let a = 1 < 2;",
      "",
      "Name | Price",
      "Book & co | <10>",
      "Pen |",
    ].join("\n"),
  );
});

Deno.test("the model gets errors it can fix, and the user hears about them", async () => {
  const { context } = await setup();

  const json = await assertRejects(() => createGeneratedFile(context, "a.json", "{oops"), GeneratedFileError);
  assertStringIncludes(json.message, "not valid JSON");
  const format = await assertRejects(() => createGeneratedFile(context, "a.exe", "x"), GeneratedFileError);
  assertStringIncludes(format.message, ".md, .txt, .csv, .json, .docx");
  await assertRejects(() => createGeneratedFile(context, "a.md", "  \n"), GeneratedFileError, "empty");
  assertEquals(context.files, []);
});

Deno.test("a file name cannot escape the attachments folder", async () => {
  const { context } = await setup();

  const file = await createGeneratedFile(context, "../../evil:name.md", "x");

  assertEquals(file.originalName, "evil_name.md");
});

Deno.test("create_file - only exists during a chat turn", async () => {
  const { context } = await setup();

  assert(!buildNativeTools(1).some((t) => t.name === "create_file"));
  const names = generatedFilesStorage.run(context, () => buildNativeTools(1).map((t) => t.name));
  assert(names.includes("create_file"));
});

Deno.test("create_file - creates the file, or reports why not without ending the turn", async () => {
  const { context, failures } = await setup();
  const createFile = generatedFilesStorage.run(
    context,
    () => buildNativeTools(1).find((t) => t.name === "create_file")!,
  );

  const ok = await createFile.invoke({ fileName: "a.csv", content: "x,y\n1,2" });
  assertStringIncludes(String(ok), "Created 'a.csv'");
  assertEquals(context.files.length, 1);

  await assertRejects(() => createFile.invoke({ fileName: "b.json", content: "{" }), Error, "not valid JSON");
  assertEquals(failures.length, 1);
  assertStringIncludes(failures[0], "Could not create 'b.json'");
});
