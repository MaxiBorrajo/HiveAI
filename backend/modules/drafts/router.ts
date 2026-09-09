import { Hono } from "hono";
import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { handleCreateDraft } from "./useCases/createDraft/index.ts";
import { handleListDrafts } from "./useCases/listDrafts/index.ts";
import { handleGetDraftFiles } from "./useCases/getDraftFiles/index.ts";
import { handleSaveDraftFile } from "./useCases/saveDraftFile/index.ts";
import { handleValidateDraft } from "./useCases/validateDraft/index.ts";
import { handleImportDraft } from "./useCases/importDraft/index.ts";
import { handleRemoveDraft } from "./useCases/removeDraft/index.ts";
import { handleExportDraft } from "./useCases/exportDraft/index.ts";

export const draftsRouter = new Hono<{
  Variables: { hive: HiveMicrokernel; model: string; selectorModel: string };
}>();

const JSON_HEADERS = { "content-type": "application/json" };

draftsRouter.get("/", (c) => handleListDrafts(c.get("hive"), JSON_HEADERS));

draftsRouter.post("/", (c) => handleCreateDraft(c.get("hive"), c.req.raw, JSON_HEADERS));

draftsRouter.get("/:name/files", (c) =>
  handleGetDraftFiles(c.get("hive"), c.req.param("name"), JSON_HEADERS));

draftsRouter.put("/:name/files", (c) =>
  handleSaveDraftFile(c.get("hive"), c.req.param("name"), c.req.raw, JSON_HEADERS));

draftsRouter.post("/:name/validate", (c) =>
  handleValidateDraft(c.get("hive"), c.req.param("name"), JSON_HEADERS));

draftsRouter.post("/:name/import", (c) =>
  handleImportDraft(c.get("hive"), c.req.param("name"), JSON_HEADERS));

draftsRouter.get("/:name/export", (c) =>
  handleExportDraft(c.get("hive"), c.req.param("name"), {}));

draftsRouter.delete("/:name", (c) =>
  handleRemoveDraft(c.get("hive"), c.req.param("name"), JSON_HEADERS));
