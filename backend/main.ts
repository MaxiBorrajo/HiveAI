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

export const homeDir: string | undefined =
  Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE")!;
const hive = HiveMicrokernel.getInstance();
const __dirname = dirname(fileURLToPath(import.meta.url));

const MODEL = "qwen3:8b";
const SELECTOR_MODEL = "qwen3:8b";

const app = new Hono<{
  Variables: { hive: HiveMicrokernel; model: string; selectorModel: string };
}>();

app.use("*", async (c, next) => {
  c.set("hive", hive);
  c.set("model", MODEL);
  c.set("selectorModel", SELECTOR_MODEL);
  await next();
});

app.use(
  "/api/*",
  cors({
    origin: "*",
    allowHeaders: ["content-type"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  }),
);

app.route("/api/plugins", pluginsRouter);
app.route("/api/chat", chatsRouter);
app.route("/api/interactions", interactionsRouter);
app.route("/api/external-plugin-callbacks", externalPluginCallbacksRouter);
app.route("/api/drafts", draftsRouter);

// Serves the built frontend directly (packaged desktop app / production).
app.use("/*", serveStatic({ root: "../frontend/dist" }));

app.get("/", (c) => c.json("Welcome to HiveAI"));

// A random free port avoids clashing with anything already running (or a
// previous instance that didn't shut down cleanly). Written to
// frontend/.env.local so the separate Vite dev server (used in local
// development, alongside this same backend) knows which port to call.
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

// External plugin subprocesses proxy requestApproval/reportStep back to this
// same process over HTTP (see modules/externalPluginCallbacks) — they need
// this process's own address, which is only known once the server above is
// listening.
hive.configure({
  dataDir: join(homeDir, ".hiveai", "storage"),
  model: MODEL,
  callbackBaseUrl: `http://localhost:${port}/api/external-plugin-callbacks`,
});

async function loadPlugins() {
  const pluginsDir = join(__dirname, "plugins");
  for await (const entry of Deno.readDir(pluginsDir)) {
    if (entry.isDirectory) {
      await hive.loadAndRegister(join(pluginsDir, entry.name));
    }
  }

  // Relaunches every plugin the user imported in a previous session as its
  // own subprocess — see core/microkernel/external-plugins/ for why they run
  // out-of-process instead of being import()'d directly.
  await hive.loadPersistedExternalPlugins();

  console.log(
    "Registered plugins:",
    hive.getRegisteredPlugins().map((p) => p.name),
  );
}

await loadPlugins();
