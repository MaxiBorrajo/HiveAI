import { Hono } from "hono";
import { ResponseBuilder } from "../../core/api/response.ts";
import { getReadyVersion } from "./lib/update-state.ts";

export const appUpdatesRouter = new Hono();

appUpdatesRouter.get("/update", () => {
  return ResponseBuilder.success(
    {
      currentVersion: Deno.desktopVersion ?? null,
      readyVersion: getReadyVersion(),
    },
    { headers: { "content-type": "application/json" } },
  );
});
