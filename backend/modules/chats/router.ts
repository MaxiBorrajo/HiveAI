import { parseId } from "../../core/api/errors.ts";
import { Hono } from "hono";
import { listChats } from "./use-cases/list-chats.ts";
import { getChatMessages } from "./use-cases/get-chat-messages.ts";
import { deleteChat } from "./use-cases/delete-chat.ts";
import { updateChat } from "./use-cases/update-chat.ts";
import { forkChat } from "./use-cases/fork-chat.ts";
import { sendMessage } from "./use-cases/send-message.ts";
import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { getORM } from "../../infrastructure/db/orm.ts";
import {
  requireEmbeddingModelAvailable,
  requireModelsConfigured,
} from "../../core/api/guards.ts";

export const chatsRouter = new Hono<{ Variables: { hive: HiveMicrokernel } }>();

chatsRouter.post("/", async (c) => {
  const headers = { "content-type": "application/json" };
  const hive = c.get("hive");
  const db = getORM();

  const guardError = requireModelsConfigured(hive, headers);
  if (guardError) return guardError;

  const embeddingGuardError = await requireEmbeddingModelAvailable(headers);
  if (embeddingGuardError) return embeddingGuardError;

  const config = hive.getConfig();
  const body = await c.req.json().catch(() => ({}));

  const attachmentIds = Array.isArray(body.attachmentIds)
    ? body.attachmentIds.filter((id: unknown) => typeof id === "number")
    : [];

  return sendMessage(
    db,
    body.chatId || null,
    body.message || "",
    hive,
    config.get("model"),
    c.req.raw,
    headers,
    attachmentIds,
  );
});

chatsRouter.get("/", async (c) => {
  const headers = { "content-type": "application/json" };
  const db = getORM();
  return listChats(db, headers);
});

chatsRouter.get("/:id", async (c) => {
  const headers = { "content-type": "application/json" };
  const db = getORM();
  return getChatMessages(db, c.req.param("id"), headers);
});

chatsRouter.delete("/:id", async (c) => {
  const headers = { "content-type": "application/json" };
  const db = getORM();
  const dataDir = c.get("hive").getConfig().get("dataDir");
  return deleteChat(db, parseId(c.req.param("id")), headers, dataDir);
});

chatsRouter.patch("/:id", async (c) => {
  const headers = { "content-type": "application/json" };
  const db = getORM();
  const body = await c.req.json().catch(() => ({}));
  return updateChat(db, parseId(c.req.param("id")), body, headers);
});

chatsRouter.put("/:id", async (c) => {
  const headers = { "content-type": "application/json" };
  const db = getORM();
  const body = await c.req.json().catch(() => ({}));
  return updateChat(db, parseId(c.req.param("id")), body, headers);
});

chatsRouter.post("/:id/fork", async (c) => {
  const headers = { "content-type": "application/json" };
  const db = getORM();
  const dataDir = c.get("hive").getConfig().get("dataDir");
  const body = await c.req.json().catch(() => ({}));
  const messageId = Number(body.messageId);
  return forkChat(db, parseId(c.req.param("id")), messageId, dataDir, headers);
});
