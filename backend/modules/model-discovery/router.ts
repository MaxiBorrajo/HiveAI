import { Hono } from "hono";
import type { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { handleDetail, handleSearch } from "./use-cases/model-discovery.ts";

export const modelDiscoveryRouter = new Hono<{
  Variables: { hive: HiveMicrokernel };
}>();
const json = { "content-type": "application/json" };

modelDiscoveryRouter.get("/search", (c) =>
  handleSearch(c.get("hive"), c.req.query(), json));

modelDiscoveryRouter.get("/model", (c) =>
  handleDetail(c.get("hive"), c.req.query("id"), c.req.query("source"), json));
