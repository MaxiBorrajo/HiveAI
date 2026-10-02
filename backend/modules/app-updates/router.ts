import { Hono } from "hono";
import { getUpdateStatus } from "./use-cases/get-update-status.ts";

export const appUpdatesRouter = new Hono();

appUpdatesRouter.get("/update", () => {
  return getUpdateStatus({ "content-type": "application/json" });
});
