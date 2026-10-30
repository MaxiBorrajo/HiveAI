import { Hono } from "hono";
import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { requireModelsConfigured } from "../../core/api/guards.ts";
import { generatePluginDraft } from "./use-cases/generate-plugin-draft.ts";
import { updatePluginDraft } from "./use-cases/update-plugin-draft.ts";
import { runDraftTest, type DraftTestKind } from "./use-cases/run-draft-test.ts";
import { installPluginDraft } from "./use-cases/install-plugin-draft.ts";
import { discardPluginDraft } from "./use-cases/discard-plugin-draft.ts";

export const pluginBuilderRouter = new Hono<{
  Variables: { hive: HiveMicrokernel };
}>();

pluginBuilderRouter.post("/generate", async (c) => {
  const hive = c.get("hive");
  const config = hive.getConfig();
  const headers = { "content-type": "application/json" };
  const guardError = requireModelsConfigured(hive, headers);
  if (guardError) return guardError;

  const body = await c.req.json().catch(() => ({}));
  return generatePluginDraft(
    hive,
    config.get("model"),
    body.content,
    body.sessionId,
    body.currentDraft,
    headers,
  );
});

pluginBuilderRouter.put("/:sessionId", async (c) => {
  const headers = { "content-type": "application/json" };
  const hive = c.get("hive");
  const body = await c.req.json().catch(() => ({}));
  return updatePluginDraft(hive, c.req.param("sessionId"), body.draft, headers);
});

pluginBuilderRouter.post("/:sessionId/test/:kind/:index", async (c) => {
  const headers = { "content-type": "application/json" };
  const hive = c.get("hive");

  const guardError = requireModelsConfigured(hive, headers);
  if (guardError) return guardError;

  const kind = c.req.param("kind") as DraftTestKind;
  const index = parseInt(c.req.param("index"), 10);
  const config = hive.getConfig();
  return runDraftTest(
    hive,
    config.get("model"),
    c.req.param("sessionId"),
    kind,
    index,
    c.req.raw.signal,
    headers,
  );
});

pluginBuilderRouter.post("/:sessionId/install", async (c) => {
  const headers = { "content-type": "application/json" };
  return installPluginDraft(c.get("hive"), c.req.param("sessionId"), headers);
});

pluginBuilderRouter.delete("/:sessionId", async (c) => {
  const headers = { "content-type": "application/json" };
  return discardPluginDraft(c.req.param("sessionId"), headers);
});
