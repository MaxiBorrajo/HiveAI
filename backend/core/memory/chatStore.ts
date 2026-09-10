import { getChatsTable, getMessagesTable } from "./db.ts";
import type { ChatRecord } from "./types.ts";

export async function createChat(
  dataDir: string,
  title: string,
): Promise<ChatRecord> {
  const table = await getChatsTable(dataDir);
  const now = Date.now();

  const chat: ChatRecord = {
    id: crypto.randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  };

  await table.add([{ ...chat }]);
  return chat;
}

export async function listChats(dataDir: string): Promise<ChatRecord[]> {
  const table = await getChatsTable(dataDir);
  const rows = (await table.query().toArray()) as ChatRecord[];
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getChat(
  dataDir: string,
  chatId: string,
): Promise<ChatRecord | null> {
  const table = await getChatsTable(dataDir);
  const rows = (await table
    .query()
    .where(`id = '${chatId}'`)
    .limit(1)
    .toArray()) as ChatRecord[];

  return rows[0] ?? null;
}

export async function touchChat(
  dataDir: string,
  chatId: string,
): Promise<void> {
  const table = await getChatsTable(dataDir);
  const chat = await getChat(dataDir, chatId);
  if (!chat) return;

  await table.update({
    where: `id = '${chatId}'`,
    values: {
      updatedAt: Date.now(),
      messageCount: chat.messageCount + 1,
    },
  });
}

export async function deleteChat(
  dataDir: string,
  chatId: string,
): Promise<void> {
  const chatsTable = await getChatsTable(dataDir);
  const messagesTable = await getMessagesTable(dataDir);

  await chatsTable.delete(`id = '${chatId}'`);
  await messagesTable.delete(`chatId = '${chatId}'`);
}
