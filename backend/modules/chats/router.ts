import { Hono } from "hono";
import { handleChat } from "./useCases/sendMessage/index.ts";
import { listChats } from "./useCases/listChats/index.ts";
import { getChatMessages } from "./useCases/getChatMessages/index.ts";
import { deleteChat } from "./useCases/deleteChat/index.ts";
import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import {
  requireEmbeddingModelAvailable,
  requireModelsConfigured,
} from "../../core/api/guards.ts";

export const chatsRouter = new Hono<{ Variables: { hive: HiveMicrokernel } }>();

chatsRouter.post("/", async (c) => {
  const headers = { "content-type": "application/json" };
  const hive = c.get("hive");

  const guardError = requireModelsConfigured(hive, headers);
  if (guardError) return guardError;

  const embeddingGuardError = await requireEmbeddingModelAvailable(headers);
  if (embeddingGuardError) return embeddingGuardError;

  const config = hive.getConfig();
  return handleChat(
    hive,
    config.get("model"),
    config.get("selectorModel"),
    c.req.raw,
    headers,
  );
});

chatsRouter.get("/", async (c) => {
  const headers = { "content-type": "application/json" };
  return listChats(c.get("hive"), headers);
});

chatsRouter.get("/:id", async (c) => {
  const headers = { "content-type": "application/json" };
  return getChatMessages(c.get("hive"), c.req.param("id"), headers);
});

chatsRouter.delete("/:id", async (c) => {
  const headers = { "content-type": "application/json" };
  return deleteChat(c.get("hive"), c.req.param("id"), headers);
});
