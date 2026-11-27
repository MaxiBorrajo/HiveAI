import { Hono } from "hono";
import { handleSaveDownload } from "./use-cases/save-download.ts";
import {
  handleDownloadAction,
  handleDownloadsStream,
  handleListDownloads,
  handlePreflight,
  handleStartDownload,
} from "./use-cases/pull-model.ts";

export const downloadsRouter = new Hono();
const json = { "content-type": "application/json" };

downloadsRouter.post("/", (c) => handleSaveDownload(c.req.raw, json));

downloadsRouter.get("/models", () => handleListDownloads(json));

downloadsRouter.post("/models", (c) => handleStartDownload(c.req.raw, json));

downloadsRouter.get("/models/preflight", (c) =>
  handlePreflight(c.req.query("name"), json));

downloadsRouter.post("/models/stream", (c) =>
  handleDownloadsStream(c.req.raw, json));

downloadsRouter.post("/models/:id/cancel", (c) =>
  handleDownloadAction("cancel", c.req.param("id"), json));

downloadsRouter.post("/models/:id/retry", (c) =>
  handleDownloadAction("retry", c.req.param("id"), json));
