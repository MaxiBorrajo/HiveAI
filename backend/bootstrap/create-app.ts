import { serveStatic } from "hono/deno";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { AppError } from "../core/api/errors.ts";
import { ResponseBuilder } from "../core/api/response.ts";
import type { HiveMicrokernel } from "../core/microkernel/hive-microkernel.ts";
import { pluginsRouter } from "../modules/plugins/router.ts";
import { chatsRouter } from "../modules/chats/router.ts";
import { interactionsRouter } from "../modules/interactions/router.ts";
import { externalPluginCallbacksRouter } from "../modules/external-plugin-callbacks/router.ts";
import { draftsRouter } from "../modules/drafts/router.ts";
import { modesRouter } from "../modules/modes/router.ts";
import { modelsRouter } from "../modules/models/router.ts";
import { executionsRouter } from "../modules/executions/router.ts";
import { appUpdatesRouter } from "../modules/app-updates/router.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendDistPath = join(__dirname, "../../frontend/dist");

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function createApp(hive: HiveMicrokernel) {
  const app = new Hono<{ Variables: { hive: HiveMicrokernel } }>();

  app.onError((err, _c) => {
    console.error(`Error: ${err}`);
    if (err instanceof AppError) {
      return ResponseBuilder.error([err.message], undefined, {
        status: err.status,
      });
    }
    return ResponseBuilder.error(["Internal Server Error"], undefined, {
      status: 500,
    });
  });

  app.use("*", async (c, next) => {
    c.set("hive", hive);
    await next();
  });

  app.use(
    "/api/*",
    cors({
      origin: (origin) => (LOCAL_ORIGIN.test(origin) ? origin : null),
      allowHeaders: ["content-type", "user-agent"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  app.route("/api/plugins", pluginsRouter);
  app.route("/api/chats", chatsRouter);
  app.route("/api/modes", modesRouter);
  app.route("/api/models", modelsRouter);
  app.route("/api/interactions", interactionsRouter);
  app.route("/api/external-plugin-callbacks", externalPluginCallbacksRouter);
  app.route("/api/drafts", draftsRouter);
  app.route("/api/executions", executionsRouter);
  app.route("/api/app", appUpdatesRouter);

  app.use("/*", serveStatic({ root: frontendDistPath }));

  app.get("*", async (c) => {
    try {
      const content = await Deno.readTextFile(
        join(frontendDistPath, "index.html"),
      );
      return c.html(content);
    } catch {
      return c.json(
        "Welcome to HiveAI (API is running, but frontend not found)",
        404,
      );
    }
  });

  return app;
}
