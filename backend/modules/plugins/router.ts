import { Hono } from "hono";
import { handleGetPlugins } from "./useCases/getPlugins/index.ts";
import { handleActivatePlugin } from "./useCases/activatePlugin/index.ts";
import { handleDeactivatePlugin } from "./useCases/deactivatePlugin/index.ts";
import { handleTest } from "./useCases/testPlugin/index.ts";
import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";

export const pluginsRouter = new Hono<{
  Variables: { hive: HiveMicrokernel; model: string };
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

pluginsRouter.post("/:name/test/:type/:index", async (c) => {
  const name = c.req.param("name");
  const type = c.req.param("type") as "selection" | "execution";
  const index = parseInt(c.req.param("index"), 10);
  return handleTest(
    c.get("hive"),
    c.get("model"),
    name,
    index,
    type,
    c.req.raw,
    { "content-type": "application/json" },
  );
});
