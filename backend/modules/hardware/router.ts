import { Hono } from "hono";
import type { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { handleGetHardware } from "./use-cases/get-hardware.ts";

export const hardwareRouter = new Hono<{
  Variables: { hive: HiveMicrokernel };
}>();

hardwareRouter.get("/", (c) =>
  handleGetHardware(c.get("hive"), { "content-type": "application/json" }));
