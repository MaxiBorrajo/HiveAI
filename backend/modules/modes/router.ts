import { Hono } from "hono";
import { getModes } from "./useCases/getModes/index.ts";
import { setMode } from "./useCases/setMode/index.ts";
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
