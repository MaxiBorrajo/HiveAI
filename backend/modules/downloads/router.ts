import { Hono } from "hono";
import { handleSaveDownload } from "./use-cases/save-download.ts";

export const downloadsRouter = new Hono();

downloadsRouter.post("/", (c) =>
  handleSaveDownload(c.req.raw, { "content-type": "application/json" }));
