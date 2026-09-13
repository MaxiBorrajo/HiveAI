import { Hono } from "hono";
import { handleGetPlugins } from "./useCases/getPlugins/index.ts";
import { handleActivatePlugin } from "./useCases/activatePlugin/index.ts";
import { handleDeactivatePlugin } from "./useCases/deactivatePlugin/index.ts";
import { handleTest } from "./useCases/testPlugin/index.ts";
import { handleImportPlugin } from "./useCases/importPlugin/index.ts";
import { handleRemovePlugin } from "./useCases/removePlugin/index.ts";
import { handleExportPlugin } from "./useCases/exportPlugin/index.ts";
import { handleEditPlugin } from "./useCases/editPlugin/index.ts";
import { handleSaveTestResults } from "./useCases/saveTestResults/index.ts";
import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { requireModelsConfigured } from "../../core/api/guards.ts";

export const pluginsRouter = new Hono<{
  Variables: { hive: HiveMicrokernel };
}>();

pluginsRouter.get("/", (c) => {
  return handleGetPlugins(c.get("hive"), {
    "content-type": "application/json",
  });
});

pluginsRouter.post("/:name/activate", (c) => {
  const name = c.req.param("name");
  return handleActivatePlugin(c.get("hive"), name, {
    "content-type": "application/json",
  });
});

pluginsRouter.post("/:name/deactivate", (c) => {
  const name = c.req.param("name");
  return handleDeactivatePlugin(c.get("hive"), name, {
    "content-type": "application/json",
  });
});

pluginsRouter.post("/import", (c) => {
  return handleImportPlugin(c.get("hive"), c.req.raw, {
    "content-type": "application/json",
  });
});

pluginsRouter.get("/:name/export", (c) => {
  const name = c.req.param("name");
  return handleExportPlugin(c.get("hive"), name, {});
});

pluginsRouter.post("/:name/edit", (c) => {
  const name = c.req.param("name");
  return handleEditPlugin(c.get("hive"), name, {
    "content-type": "application/json",
  });
});

pluginsRouter.delete("/:name", (c) => {
  const name = c.req.param("name");
  return handleRemovePlugin(c.get("hive"), name, {
    "content-type": "application/json",
  });
});

pluginsRouter.post("/test-results", async (c) => {
  return handleSaveTestResults(c.req.raw, {
    "content-type": "application/json",
  });
});

pluginsRouter.post("/:name/test/:type/:index", async (c) => {
  const headers = { "content-type": "application/json" };
  const hive = c.get("hive");

  const guardError = requireModelsConfigured(hive, headers);
  if (guardError) return guardError;

  const name = c.req.param("name");
  const type = c.req.param("type") as "selection" | "execution";
  const index = parseInt(c.req.param("index"), 10);
  const config = hive.getConfig();
  return handleTest(
    hive,
    config.get("model"),
    name,
    index,
    type,
    c.req.raw,
    headers,
  );
});
