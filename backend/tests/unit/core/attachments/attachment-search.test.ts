import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { initORM, type AppDatabase } from "../../../../infrastructure/db/orm.ts";
import { ChatRepository } from "../../../../infrastructure/db/repositories/chat-repository.ts";
import { MessageRepository } from "../../../../infrastructure/db/repositories/message-repository.ts";
import { AttachmentRepository } from "../../../../infrastructure/db/repositories/attachment-repository.ts";
import { saveAttachment } from "../../../../core/attachments/attachment-storage.ts";
import {
  chunkText,
  indexAttachment,
  MAX_CHUNKS_PER_FILE,
} from "../../../../core/attachments/attachment-index.ts";
import { retrieveAttachmentExcerpts } from "../../../../core/attachments/attachment-retrieval.ts";
import { attachmentBudget } from "../../../../core/attachments/context-budget.ts";
import { forkChat } from "../../../../modules/chats/use-cases/fork-chat.ts";

// One axis per topic, so similarity is decided by what the text talks about.
const embed = (text: string) =>
  Promise.resolve([
    /gato/i.test(text) ? 1 : 0,
    /perro/i.test(text) ? 1 : 0,
    /zzz/i.test(text) ? 1 : 0.01,
  ]);

async function setup() {
  const dataDir = await Deno.makeTempDir();
  const db = await initORM(dataDir);
  const repo = new AttachmentRepository(db);
  const chatId = await new ChatRepository(db).create({
    title: "chat",
    createdAt: 1,
    updatedAt: 1,
    messageCount: 1,
  });
  const messageId = await new MessageRepository(db).create({
    chatId,
    role: "user",
    content: "file",
    timestamp: 1,
    metadata: null,
    vector: "[]",
  });
  const addFile = async (
    name: string,
    content: string,
    { linked = true, mimeType = "text/plain" } = {},
  ) => {
    const storagePath = await saveAttachment(
      dataDir,
      new TextEncoder().encode(content),
      name,
    );
    return await repo.create({
      chatId,
      messageId: linked ? messageId : null,
      executionId: null,
      executionHistoryId: null,
      direction: "input",
      originalName: name,
      mimeType,
      sizeBytes: content.length,
      storagePath,
      extractedTextPath: null,
      status: "ready",
      createdAt: 1,
    });
  };
  const addIndexed = async (name: string, content: string) => {
    const row = await addFile(name, content);
    await indexAttachment(dataDir, repo, row.id, embed);
    return row;
  };
  const search = (query: string, sentChars = new Map<number, number>()) =>
    retrieveAttachmentExcerpts({
      repo,
      chatId,
      query,
      embed,
      maxChars: 12_000,
      sentChars,
    });
  return { db, dataDir, repo, chatId, messageId, addFile, addIndexed, search } as {
    db: AppDatabase;
    dataDir: string;
    repo: AttachmentRepository;
    chatId: number;
    messageId: number;
    addFile: typeof addFile;
    addIndexed: typeof addIndexed;
    search: typeof search;
  };
}

Deno.test("chunkText - covers the whole text, overlapping, and cuts at a paragraph", () => {
  const text = `${"a".repeat(1500)}\n\n${"b ".repeat(1500)}end`;
  const chunks = chunkText(text);

  assert(chunks.length > 1);
  assertEquals(chunks[0].text, `${"a".repeat(1500)}\n\n`);
  assert(chunks[1].startChar < chunks[0].text.length, "chunks overlap");
  for (let i = 1; i < chunks.length; i++) {
    const previousEnd = chunks[i - 1].startChar + chunks[i - 1].text.length;
    assert(chunks[i].startChar <= previousEnd, "no gap between chunks");
  }
  assert(chunks.at(-1)!.text.endsWith("end"));
  assertEquals(chunkText(text), chunks, "same text, same chunks");
});

Deno.test("chunkText - a text without separators still advances", () => {
  assertEquals(chunkText("x".repeat(5000)).length, 3);
  assertEquals(chunkText("   \n "), []);
});

Deno.test("indexAttachment - stores every chunk and marks the file ready", async () => {
  const { dataDir, repo, addFile } = await setup();
  const row = await addFile("a.txt", "gato ".repeat(1000));

  await indexAttachment(dataDir, repo, row.id, embed);

  assertEquals(await repo.countChunks(row.id), chunkText("gato ".repeat(1000)).length);
  assert((await repo.findById(row.id))!.indexedAt !== null);
});

Deno.test("indexAttachment - resumes after a failure without repeating chunks", async () => {
  const { dataDir, repo, addFile } = await setup();
  const content = "gato ".repeat(1000);
  const row = await addFile("a.txt", content);
  let calls = 0;
  const failsOnSecond = (text: string) =>
    ++calls === 2 ? Promise.reject(new Error("ollama down")) : embed(text);

  await assertRejects(() => indexAttachment(dataDir, repo, row.id, failsOnSecond));
  assertEquals(await repo.countChunks(row.id), 1);
  assertEquals((await repo.findById(row.id))!.indexedAt, null);

  const total = chunkText(content).length;
  let resumed = 0;
  await indexAttachment(dataDir, repo, row.id, (text) => {
    resumed++;
    return embed(text);
  });
  assertEquals(resumed, total - 1);
  assertEquals(await repo.countChunks(row.id), total);
});

Deno.test("indexAttachment - stops at the chunk limit", async () => {
  const { dataDir, repo, addFile } = await setup();
  const row = await addFile("a.txt", "x".repeat((MAX_CHUNKS_PER_FILE + 5) * 1800));

  await indexAttachment(dataDir, repo, row.id, embed);

  assertEquals(await repo.countChunks(row.id), MAX_CHUNKS_PER_FILE);
});

Deno.test("indexAttachment - stops quietly when the file is deleted meanwhile", async () => {
  const { dataDir, repo, addFile } = await setup();
  const row = await addFile("a.txt", "gato ".repeat(1000));
  let calls = 0;

  await indexAttachment(dataDir, repo, row.id, async (text) => {
    if (++calls === 1) {
      await repo.delete(row.id);
      return [];
    }
    return embed(text);
  }).catch(() => {});

  assertEquals(calls, 1);
  assertEquals(await repo.countChunks(row.id), 0);
});

Deno.test("search - finds a file from an earlier turn by meaning", async () => {
  const { addIndexed, search } = await setup();
  await addIndexed("gatos.txt", "El gato duerme.");
  await addIndexed("perros.txt", "El perro corre.");

  const { text, warnings } = await search("que hace el gato?");

  assertStringIncludes(text!, "[from 'gatos.txt']\nEl gato duerme.");
  assert(!text!.includes("perros.txt"));
  assertEquals(warnings, []);
});

Deno.test("search - an exact code the embedding cannot tell apart leaves the rest out", async () => {
  const { addIndexed, search } = await setup();
  await addIndexed("otro.txt", "Referencia RUBI-12 del contrato.");
  await addIndexed("contrato.txt", "Referencia ZAFIRO-77 del contrato.");

  const { text } = await search("ZAFIRO-77");

  assertStringIncludes(text!, "contrato.txt");
  assert(!text!.includes("otro.txt"));
});

Deno.test("attachmentBudget - local models get a share of their context window", () => {
  assertEquals(attachmentBudget(8192), {
    attachmentChars: 12_288,
    excerptChars: 6_144,
  });
});

Deno.test("attachmentBudget - cloud models and huge windows hit the fixed limits", () => {
  const cloud = { attachmentChars: 100_000, excerptChars: 12_000 };
  assertEquals(attachmentBudget(undefined), cloud);
  assertEquals(attachmentBudget(1_000_000), cloud);
});

Deno.test("search - a file sent whole in this message adds no excerpts or warnings", async () => {
  const { addFile, addIndexed, search } = await setup();
  const indexed = await addIndexed("gatos.txt", "El gato duerme.");
  const stillIndexing = await addFile("nuevo.txt", "El gato come.");

  const result = await search(
    "gato",
    new Map([[indexed.id, Infinity], [stillIndexing.id, Infinity]]),
  );

  assertEquals(result, { text: undefined, warnings: [] });
});

Deno.test("search - a truncated file only contributes what the message did not carry", async () => {
  const { addIndexed, search } = await setup();
  const head = `INICIO ${"gato cabeza ".repeat(200)}`;
  const tail = "gato final ".repeat(100);
  const row = await addIndexed("largo.txt", head + tail);

  const { text } = await search("gato", new Map([[row.id, head.length]]));

  assertStringIncludes(text!, "gato final");
  assert(!text!.includes("INICIO"));
});

Deno.test("search - warns about a file that is still being indexed", async () => {
  const { addFile, search } = await setup();
  await addFile("pendiente.txt", "El gato.");

  const { warnings } = await search("gato");

  assertEquals(warnings.length, 1);
  assertStringIncludes(warnings[0], "'pendiente.txt' is still being prepared");
});

Deno.test("search - warns when a file attached now is only partly searchable", async () => {
  const { dataDir, repo, addFile, search } = await setup();
  const row = await addFile("enorme.txt", "x".repeat((MAX_CHUNKS_PER_FILE + 5) * 1800));
  await indexAttachment(dataDir, repo, row.id, embed);

  const { warnings } = await search("gato", new Map([[row.id, 100]]));

  assertStringIncludes(warnings[0], "too long to search completely");
});

Deno.test("search - stays within its character budget", async () => {
  const { addIndexed, search } = await setup();
  await addIndexed("largo.txt", "gato ".repeat(20_000));

  const { text } = await search("gato");

  assert(text!.length < 14_000);
});

Deno.test("search - when nothing matches, the model still learns the files exist", async () => {
  const { addIndexed, search } = await setup();
  await addIndexed("gatos.txt", "El gato duerme.");

  const { text } = await search("zzz");

  assertStringIncludes(text!, "files attached earlier in this chat: 'gatos.txt'");
});

Deno.test("search - ignores images and files not sent yet", async () => {
  const { addFile, search } = await setup();
  await addFile("a.png", "gato", { mimeType: "image/png" });
  await addFile("borrador.txt", "gato", { linked: false });

  assertEquals(await search("gato"), { text: undefined, warnings: [] });
});

Deno.test("search index - unindexed files of the chat are listed, images are not", async () => {
  const { repo, chatId, addFile, addIndexed } = await setup();
  const pending = await addFile("a.txt", "gato");
  await addFile("a.png", "x", { mimeType: "image/png" });
  await addIndexed("b.txt", "gato");

  assertEquals(await repo.findUnindexedChatIds(chatId), [pending.id]);
});

Deno.test("search index - deleting a file removes its chunks", async () => {
  const { repo, addIndexed } = await setup();
  const row = await addIndexed("a.txt", "gato");

  await repo.delete(row.id);

  assertEquals(await repo.findChunks([row.id]), []);
});

Deno.test("search index - a forked chat can search without indexing again", async () => {
  const { db, dataDir, repo, chatId, messageId, addIndexed } = await setup();
  await addIndexed("gatos.txt", "El gato duerme.");

  const response = await forkChat(db, chatId, messageId, dataDir, {});
  const forkedChatId = Number((await response.json()).data.id);

  assertEquals(await repo.findUnindexedChatIds(forkedChatId), []);
  const { text } = await retrieveAttachmentExcerpts({
    repo,
    chatId: forkedChatId,
    query: "gato",
    embed,
    maxChars: 12_000,
    sentChars: new Map(),
  });
  assertStringIncludes(text!, "El gato duerme.");
});
