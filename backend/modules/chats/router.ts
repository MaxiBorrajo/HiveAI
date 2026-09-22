import { Hono } from "hono";
import { listChats } from "./useCases/listChats/index.ts";
import { getChatMessages } from "./useCases/getChatMessages/index.ts";
import { deleteChat } from "./useCases/deleteChat/index.ts";
import { sendMessage } from "./useCases/sendMessage/index.ts";
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
  
  return sendMessage(db, body.chatId || null, body.message || "", hive, config.get("model"), c.req.raw, headers);
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
  return deleteChat(db, parseInt(c.req.param("id")), headers);
});
