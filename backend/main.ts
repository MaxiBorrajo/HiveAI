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
import { initORM } from "./infrastructure/db/orm.ts";
import { executionsRouter } from "./modules/executions/router.ts";

export const homeDir: string | undefined =
  Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE")!;
const hive = HiveMicrokernel.getInstance();
const __dirname = dirname(fileURLToPath(import.meta.url));

const app = new Hono<{
  Variables: { hive: HiveMicrokernel };
}>();

app.onError((err, c) => {
    console.error(`Error: ${err}`);
    return c.text('Internal Server Error', 500);
});

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
app.route("/api/executions", executionsRouter);

const frontendDistPath = join(__dirname, "../frontend/dist");


app.use("/*", serveStatic({ root: frontendDistPath }));

// Fallback for React Router (SPA)
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

hive.getConfig().setDataDir(join(homeDir, ".hiveai", "storage"));
hive.getConfig().setConfigDir(join(homeDir, ".hiveai", "config"));
await hive.getConfig().load();

const dataDir = hive.getConfig().get("dataDir");
await initORM(dataDir);

const server = Deno.serve({ port: 0 }, app.fetch);
const port = (server.addr as Deno.NetAddr).port;
try {
  Deno.writeTextFileSync(
    join(__dirname, "../frontend/.env"),
    `VITE_API_URL=http://localhost:${port}`,
  );
} catch (error) {
  // Ignorar si estamos en modo compilado (desktop) y no se puede escribir el archivo.
}

console.log(`\n🚀 Backend is running on http://localhost:${port}`);

type DesktopWindow = {
  navigate?: (url: string) => void;
  setSize?: (w: number, h: number) => void;
  setTitle?: (t: string) => void;
  setApplicationMenu?: (menu: unknown[]) => void;
  executeJs?: (code: string) => Promise<unknown>;
  addEventListener?: (
    type: string,
    cb: (e: { detail?: { id?: string } }) => void,
  ) => void;
};

const desktop = Deno as unknown as {
  BrowserWindow?: new (opts: Record<string, unknown>) => DesktopWindow;
};

if (desktop.BrowserWindow) {
  const win = new desktop.BrowserWindow({
    title: "HiveAI Desktop",
    width: 1200,
    height: 800,
  });
  if (win.navigate) {
    win.navigate(`http://localhost:${port}`);
  }
  console.log("🖥️  Desktop window opened!");
} else {
  console.log(
    "ℹ️  Tip: Run with 'deno desktop backend/main.ts' to open as a desktop app.",
  );
}

hive.configure({
  model: hive.getConfig().get("model"),
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
