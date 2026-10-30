import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { initORM } from "../../../../../infrastructure/db/orm.ts";
import { ChatRepository } from "../../../../../infrastructure/db/repositories/chat-repository.ts";
import { MessageRepository } from "../../../../../infrastructure/db/repositories/message-repository.ts";
import { AttachmentRepository } from "../../../../../infrastructure/db/repositories/attachment-repository.ts";
import { saveAttachment } from "../../../../../core/attachments/attachment-storage.ts";
import { forkChat } from "../../../../../modules/chats/use-cases/fork-chat.ts";

Deno.test("forkChat - copies history up to the chosen message, leaves the original intact", async () => {
  const dataDir = await Deno.makeTempDir();
  const db = await initORM(dataDir);
  const chats = new ChatRepository(db);
  const messages = new MessageRepository(db);

  const chatId = await chats.create({
    title: "original chat",
    createdAt: 1,
    updatedAt: 1,
    messageCount: 0,
  });

  const add = (role: string, content: string) =>
    messages.create({
      chatId,
      role,
      content,
      timestamp: Date.now(),
      metadata: null,
      vector: "[]",
    });

  const m1 = await add("user", "first question");
  const m2 = await add("agent", "first answer");
  await add("user", "second question — should NOT be in the fork");
  await add("agent", "second answer — should NOT be in the fork");

  const response = await forkChat(db, chatId, m2, dataDir, {});
  assertEquals(response.status, 200);
  const { data } = await response.json();
  const newChatId = Number(data.id);
  assertNotEquals(newChatId, chatId);

  const forkedMessages = await messages.findByChatId(newChatId);
  assertEquals(forkedMessages.length, 2);
  assertEquals(forkedMessages.map((m) => m.content), [
    "first question",
    "first answer",
  ]);
  assertEquals(forkedMessages[0].id === m1, false, "fork gets its own message ids");

  const originalMessages = await messages.findByChatId(chatId);
  assertEquals(originalMessages.length, 4, "original chat keeps all its messages");

  const originalChat = await chats.findById(chatId);
  assertEquals(originalChat!.title, "original chat", "original chat is unmodified");

  const forkedChat = await chats.findById(newChatId);
  assert(forkedChat!.title.includes("original chat"));
});

Deno.test("forkChat - copies attachments linked to messages up to the cutoff, as independent files", async () => {
  const dataDir = await Deno.makeTempDir();
  const db = await initORM(dataDir);
  const chats = new ChatRepository(db);
  const messages = new MessageRepository(db);
  const attachmentRepo = new AttachmentRepository(db);

  const chatId = await chats.create({
    title: "chat with files",
    createdAt: 1,
    updatedAt: 1,
    messageCount: 0,
  });

  const m1 = await messages.create({
    chatId,
    role: "user",
    content: "here's a file",
    timestamp: Date.now(),
    metadata: null,
    vector: "[]",
  });

  const storagePath = await saveAttachment(
    dataDir,
    new TextEncoder().encode("hello world"),
    "notes.txt",
  );
  const attachment = await attachmentRepo.create({
    chatId,
    messageId: m1,
    executionId: null,
    executionHistoryId: null,
    direction: "input",
    originalName: "notes.txt",
    mimeType: "text/plain",
    sizeBytes: 11,
    storagePath,
    extractedTextPath: null,
    status: "ready",
    createdAt: Date.now(),
  });

  const response = await forkChat(db, chatId, m1, dataDir, {});
  const { data } = await response.json();
  const newChatId = Number(data.id);

  const forkedAttachments = await attachmentRepo.findByChatId(newChatId);
  assertEquals(forkedAttachments.length, 1);
  assertNotEquals(forkedAttachments[0].storagePath, attachment.storagePath);
  assertEquals(forkedAttachments[0].originalName, "notes.txt");

  const copiedBytes = await Deno.readTextFile(
    `${dataDir}/${forkedAttachments[0].storagePath}`,
  );
  assertEquals(copiedBytes, "hello world");

  const originalAttachments = await attachmentRepo.findByChatId(chatId);
  assertEquals(originalAttachments.length, 1, "original attachment untouched");
});
