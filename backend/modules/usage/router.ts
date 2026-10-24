import { Hono } from "hono";
import { ResponseBuilder } from "../../core/api/response.ts";
import type { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { getORM } from "../../infrastructure/db/orm.ts";
import { ModelUsageRepository } from "../../infrastructure/db/repositories/model-usage-repository.ts";
import { parseUsageFilters } from "./parse-usage-filters.ts";

export const usageRouter = new Hono<{
  Variables: { hive: HiveMicrokernel };
}>();

usageRouter.get("/", async (c) => {
  const filters = parseUsageFilters(c.req.query());
  const records = await new ModelUsageRepository(getORM()).list(filters);
  return ResponseBuilder.success({
    records,
    limit: filters.limit,
    offset: filters.offset,
  });
});
