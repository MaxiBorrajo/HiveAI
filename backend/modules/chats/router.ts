import { Hono } from "hono";
import { handleChat } from "./useCases/sendMessage/index.ts";
import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";

export const chatsRouter = new Hono<{ Variables: { hive: HiveMicrokernel; model: string; selectorModel: string} }>();

chatsRouter.post("/", async (c) => {
  return handleChat(c.get("hive"), c.get("model"), c.get("selectorModel"), c.req.raw, { "content-type": "application/json" });
});
