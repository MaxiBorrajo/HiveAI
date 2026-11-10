import { assertEquals } from "@std/assert";
import { fileURLToPath } from "node:url";
import { initORM, type AppDatabase } from "../../../../../infrastructure/db/orm.ts";
import { ChatRepository } from "../../../../../infrastructure/db/repositories/chat-repository.ts";
import { MessageRepository } from "../../../../../infrastructure/db/repositories/message-repository.ts";
import { AttachmentRepository } from "../../../../../infrastructure/db/repositories/attachment-repository.ts";
import { saveAttachment } from "../../../../../core/attachments/attachment-storage.ts";
import { toHumanContent } from "../../../../../core/attachments/to-human-content.ts";
import { getChatMessages } from "../../../../../modules/chats/use-cases/get-chat-messages.ts";
import { forkChat } from "../../../../../modules/chats/use-cases/fork-chat.ts";

// Uploaded from the new-chat screen: the chat does not exist yet.
async function seedFirstMessageWithFile(db: AppDatabase, dataDir: string) {
  const attachmentRepo = new AttachmentRepository(db);
  const storagePath = await saveAttachment(
    dataDir,
    new TextEncoder().encode("hello"),
    "notes.txt",
  );
  const attachment = await attachmentRepo.create({
    chatId: null,
    executionId: null,
    messageId: null,
    executionHistoryId: null,
    direction: "input",
    originalName: "notes.txt",
    mimeType: "text/plain",
    sizeBytes: 5,
    storagePath,
    extractedTextPath: null,
    status: "ready",
    createdAt: 1,
  });
  const chatId = await new ChatRepository(db).create({
    title: "new chat",
    createdAt: 1,
    updatedAt: 1,
    messageCount: 1,
  });
  const messageId = await new MessageRepository(db).create({
    chatId,
    role: "user",
    content: "read this",
    timestamp: 1,
    metadata: null,
    vector: "[]",
  });
  return { attachmentRepo, attachment, chatId, messageId };
}

async function historyAttachmentNames(db: AppDatabase, chatId: number) {
  const response = await getChatMessages(db, String(chatId), {});
  const { data } = await response.json();
  return data.messages.map((m: { attachments: { originalName: string }[] }) =>
    m.attachments.map((a) => a.originalName)
  );
}

Deno.test("a file sent with the first message of a new chat stays in its history", async () => {
  const dataDir = await Deno.makeTempDir();
  const db = await initORM(dataDir);
  const { attachmentRepo, attachment, chatId, messageId } =
    await seedFirstMessageWithFile(db, dataDir);

  await attachmentRepo.linkToMessage(attachment.id, messageId, chatId);

  assertEquals(await historyAttachmentNames(db, chatId), [["notes.txt"]]);
});

Deno.test("a file sent with the first message of a new chat is copied to its forks", async () => {
  const dataDir = await Deno.makeTempDir();
  const db = await initORM(dataDir);
  const { attachmentRepo, attachment, chatId, messageId } =
    await seedFirstMessageWithFile(db, dataDir);
  await attachmentRepo.linkToMessage(attachment.id, messageId, chatId);

  const response = await forkChat(db, chatId, messageId, dataDir, {});
  const { data } = await response.json();

  assertEquals(await historyAttachmentNames(db, Number(data.id)), [["notes.txt"]]);
});

Deno.test("the backfill migration recovers files already orphaned from their chat", async () => {
  const dataDir = await Deno.makeTempDir();
  const db = await initORM(dataDir);
  const { attachmentRepo, attachment, chatId, messageId } =
    await seedFirstMessageWithFile(db, dataDir);
  await db.$client
    .prepare("UPDATE attachments SET messageId = ? WHERE id = ?")
    .run(messageId, attachment.id);
  assertEquals((await attachmentRepo.findById(attachment.id))!.chatId, null);

  const migration = await Deno.readTextFile(
    fileURLToPath(
      new URL(
        "../../../../../infrastructure/db/migrations/0012_backfill_attachment_chat_id.sql",
        import.meta.url,
      ),
    ),
  );
  db.$client.prepare(migration).run();

  assertEquals(await historyAttachmentNames(db, chatId), [["notes.txt"]]);
});

Deno.test("toHumanContent - images use the shape every provider accepts", () => {
  assertEquals(
    toHumanContent("look", [
      { type: "image", mimeType: "image/png", data: "QUJD" },
      { type: "text", text: "--- Attached file ---" },
    ]),
    [
      { type: "text", text: "look" },
      { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } },
      { type: "text", text: "--- Attached file ---" },
    ],
  );
});
