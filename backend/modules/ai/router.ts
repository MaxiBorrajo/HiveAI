import { Hono } from "hono";
import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";

export const aiRouter = new Hono<{ Variables: { hive: HiveMicrokernel; model: string; selectorModel: string} }>();

aiRouter.get("/", async (c) => {
  return 
});

aiRouter.get("/strategies", async (c) => {
  return 
});

aiRouter.put("/", async (c) => {
  return 
});

aiRouter.put("/strategies", async (c) => {
  return 
});