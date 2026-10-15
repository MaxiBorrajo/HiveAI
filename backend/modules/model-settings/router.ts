import { Hono } from "hono";
import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { ResponseBuilder } from "../../core/api/response.ts";
import { readModelSettings } from "./lib/settings-store.ts";
import {
  getServerEnvStatus,
  putModelSettings,
} from "./use-cases/update-model-settings.ts";

export const modelSettingsRouter = new Hono<{
  Variables: { hive: HiveMicrokernel };
}>();

const headers = { "content-type": "application/json" };

modelSettingsRouter.get("/", async () => {
  return ResponseBuilder.success(await readModelSettings(), { headers });
});

modelSettingsRouter.put("/", (c) => {
  return putModelSettings(c.get("hive"), c.req.raw, headers);
});

modelSettingsRouter.get("/server-env", async (c) => {
  return ResponseBuilder.success(await getServerEnvStatus(c.get("hive")), {
    headers,
  });
});

modelSettingsRouter.post("/server-env/dismiss", (c) => {
  c.get("hive").configure({ ollamaServerPromptDismissed: true });
  return ResponseBuilder.success({ dismissed: true }, { headers });
});
