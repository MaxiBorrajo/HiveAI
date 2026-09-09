import { Hono } from "hono";
import { handleChat } from "./useCases/sendMessage/index.ts";
import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { requireModelsConfigured } from "../../core/api/guards.ts";

export const chatsRouter = new Hono<{ Variables: { hive: HiveMicrokernel } }>();

chatsRouter.post("/", async (c) => {
  const headers = { "content-type": "application/json" };
  const hive = c.get("hive");

  const guardError = requireModelsConfigured(hive, headers);
  if (guardError) return guardError;

  const config = hive.getConfig();
  return handleChat(
    hive,
    config.get("model"),
    config.get("selectorModel"),
    c.req.raw,
    headers,
  );
});
