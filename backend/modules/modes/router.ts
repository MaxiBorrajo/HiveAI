import { Hono } from "hono";
import { getModes } from "./use-cases/get-modes.ts";
import { setMode } from "./use-cases/set-mode.ts";
import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";

export const modesRouter = new Hono<{ Variables: { hive: HiveMicrokernel } }>();

modesRouter.get("/", (c) => {
  const config = c.get("hive").getConfig();
  return getModes(config.get("model"), config.get("currentMode"), {
    "content-type": "application/json",
  });
});

modesRouter.put("/", (c) => {
  return setMode(c.get("hive"), c.req.raw, {
    "content-type": "application/json",
  });
});
