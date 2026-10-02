import { Hono } from "hono";
import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { handleCreateDraft } from "./use-cases/create-draft.ts";
import { handleListDrafts } from "./use-cases/list-drafts.ts";
import { handleGetDraftFiles } from "./use-cases/get-draft-files.ts";
import { handleSaveDraftFile } from "./use-cases/save-draft-file.ts";
import { handleValidateDraft } from "./use-cases/validate-draft.ts";
import { handleImportDraft } from "./use-cases/import-draft.ts";
import { handleRemoveDraft } from "./use-cases/remove-draft.ts";
import { handleExportDraft } from "./use-cases/export-draft.ts";

export const draftsRouter = new Hono<{
  Variables: { hive: HiveMicrokernel };
}>();

const JSON_HEADERS = { "content-type": "application/json" };

draftsRouter.get("/", (c) => handleListDrafts(c.get("hive"), JSON_HEADERS));

draftsRouter.post("/", (c) =>
  handleCreateDraft(c.get("hive"), c.req.raw, JSON_HEADERS),
);

draftsRouter.get("/:name/files", (c) =>
  handleGetDraftFiles(c.get("hive"), c.req.param("name"), JSON_HEADERS),
);

draftsRouter.put("/:name/files", (c) =>
  handleSaveDraftFile(
    c.get("hive"),
    c.req.param("name"),
    c.req.raw,
    JSON_HEADERS,
  ),
);

draftsRouter.post("/:name/validate", (c) =>
  handleValidateDraft(c.get("hive"), c.req.param("name"), JSON_HEADERS),
);

draftsRouter.post("/:name/import", (c) =>
  handleImportDraft(c.get("hive"), c.req.param("name"), JSON_HEADERS),
);

draftsRouter.get("/:name/export", (c) =>
  handleExportDraft(c.get("hive"), c.req.param("name"), {}),
);

draftsRouter.delete("/:name", (c) =>
  handleRemoveDraft(c.get("hive"), c.req.param("name"), JSON_HEADERS),
);
