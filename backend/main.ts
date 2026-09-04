import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HiveMind } from "./ai/strategy/SADER/graph.ts";
// 1. Configuramos el Backend
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HiveMicrokernel } from "./core/microkernel/hive-microkernel.ts";
import { pluginsRouter } from "./modules/plugins/router.ts";
import { chatsRouter } from "./modules/chats/router.ts";

const hive = HiveMicrokernel.getInstance();
const homeDir = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE")!;
const __dirname = dirname(fileURLToPath(import.meta.url));

const MODEL = "qwen3:8b";

hive.configure({
  dataDir: join(homeDir, ".hiveai", "storage"),
  testDir: join(homeDir, ".hiveai", "tests"),
  model: MODEL,
});

async function loadPlugins() {
  const pluginsDir = join(__dirname, "plugins");
  for await (const entry of Deno.readDir(pluginsDir)) {
    if (entry.isDirectory) {
      await hive.loadAndRegister(join(pluginsDir, entry.name));
    }
  }
  console.log("Registered plugins:", hive.getRegisteredPlugins().map((p) => p.name));
}

await loadPlugins();

const app = new Hono<{ Variables: { hive: HiveMicrokernel; model: string } }>();

// Middleware to inject dependencies
app.use("*", async (c, next) => {
  c.set("hive", hive);
  c.set("model", MODEL);
  await next();
});

// Enable CORS for frontend development
app.use("/api/*", cors({
  origin: "*",
  allowHeaders: ["content-type"],
  allowMethods: ["GET", "POST", "OPTIONS"],
}));
app.use("/plugins/*", cors({
  origin: "*",
  allowHeaders: ["content-type"],
  allowMethods: ["GET", "POST", "OPTIONS"],
}));
app.use("/chat/*", cors({
  origin: "*",
  allowHeaders: ["content-type"],
  allowMethods: ["GET", "POST", "OPTIONS"],
}));

// Route plugins and chat under /api
app.route("/api/plugins", pluginsRouter);
app.route("/api/chat", chatsRouter);

// Map routes (keeping backwards compatibility with old paths for now, or prefixing with /api)
// The frontend currently calls /plugins and /chat directly (no /api prefix)
app.route("/plugins", pluginsRouter);
app.route("/chat", chatsRouter);
// Serve the compiled frontend
import { serveStatic } from "hono/serve-static";
app.use("/*", serveStatic({ root: "../frontend/dist" }));

app.get("/", (c) => c.json("Welcome to HiveAI"));

export default {
  port: 8000,
  fetch: app.fetch,
};
