import { serveStatic } from "hono/deno";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HiveMicrokernel } from "./core/microkernel/hive-microkernel.ts";
import { pluginsRouter } from "./modules/plugins/router.ts";
import { chatsRouter } from "./modules/chats/router.ts";
import { interactionsRouter } from "./modules/interactions/router.ts";
import { externalPluginCallbacksRouter } from "./modules/externalPluginCallbacks/router.ts";
import { draftsRouter } from "./modules/drafts/router.ts";
import { modesRouter } from "./modules/modes/router.ts";
import { modelsRouter } from "./modules/models/router.ts";

export const homeDir: string | undefined =
  Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE")!;
const hive = HiveMicrokernel.getInstance();
const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_MODEL = "qwen3:8b";

const app = new Hono<{
  Variables: { hive: HiveMicrokernel };
}>();

app.use("*", async (c, next) => {
  c.set("hive", hive);
  await next();
});

app.use(
  "/api/*",
  cors({
    origin: "*",
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

app.use("/*", serveStatic({ root: "../frontend/dist" }));

app.get("/", (c) => c.json("Welcome to HiveAI"));

const server = Deno.serve({ port: 0 }, app.fetch);
const port = (server.addr as Deno.NetAddr).port;
Deno.writeTextFileSync(
  join(__dirname, "../frontend/.env.local"),
  `VITE_API_URL=http://localhost:${port}`,
);
console.log(`\n🚀 Backend is running on http://localhost:${port}`);
console.log(
  `📝 Updated frontend/.env.local with VITE_API_URL=http://localhost:${port}`,
);

hive.getConfig().setDataDir(join(homeDir, ".hiveai", "storage"));
hive.getConfig().setConfigDir(join(homeDir, ".hiveai", "config"));
await hive.getConfig().load();

hive.configure({
  model: hive.getConfig().get("model") || DEFAULT_MODEL,
  callbackBaseUrl: `http://localhost:${port}/api/external-plugin-callbacks`,
});

async function loadPlugins() {
  const pluginsDir = join(__dirname, "plugins");
  for await (const entry of Deno.readDir(pluginsDir)) {
    if (entry.isDirectory) {
      await hive.loadAndRegister(join(pluginsDir, entry.name));
    }
  }
  for (const plugin of hive.getRegisteredPlugins()) {
    await hive.activate(plugin.name);
  }

  await hive.loadPersistedExternalPlugins();

  console.log(
    "Registered plugins:",
    hive.getRegisteredPlugins().map((p) => p.name),
  );
}

await loadPlugins();
