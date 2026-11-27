import { Hono } from "hono";
import { AppError } from "../../core/api/errors.ts";
import { ResponseBuilder } from "../../core/api/response.ts";
import type { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { isAutostartEnabled, setAutostart } from "./autostart.ts";
import { showAppWindow } from "./window-controls.ts";

export const appSettingsRouter = new Hono<{
  Variables: { hive: HiveMicrokernel };
}>();

async function snapshot(hive: HiveMicrokernel) {
  return {
    launchAtLogin: await isAutostartEnabled(),
    runInBackground: hive.getConfig().get("runInBackground"),
  };
}

appSettingsRouter.get("/background", async (c) =>
  ResponseBuilder.success(await snapshot(c.get("hive"))));

appSettingsRouter.put("/background", async (c) => {
  const hive = c.get("hive");
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.runInBackground === "boolean") {
    hive.getConfig().set({ runInBackground: body.runInBackground });
  }
  if (typeof body.launchAtLogin === "boolean") {
    try {
      await setAutostart(body.launchAtLogin);
    } catch (error) {
      throw new AppError(
        error instanceof Error ? error.message : "Could not change startup.",
        422,
      );
    }
  }
  return ResponseBuilder.success(await snapshot(hive));
});

/** Used by a second launch to bring this instance's window forward. */
appSettingsRouter.post("/show", () =>
  ResponseBuilder.success({ shown: showAppWindow() }));
