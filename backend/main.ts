import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HiveMicrokernel } from "./core/microkernel/hive-microkernel.ts";
import { initORM } from "./infrastructure/db/orm.ts";
import { homeDir } from "./core/env.ts";
import { createApp } from "./app.ts";
import { openDesktopWindow } from "./desktop.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const hive = HiveMicrokernel.getInstance();

async function loadPlugins() {
  const pluginsDir = join(__dirname, "plugins");

  for await (const entry of Deno.readDir(pluginsDir)) {
    if (!entry.isDirectory) continue;
    try {
      await hive.loadAndRegister(join(pluginsDir, entry.name));
    } catch (error) {
      console.error(`Failed to load bundled plugin '${entry.name}':`, error);
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

hive.getConfig().setDataDir(join(homeDir, ".hiveai", "storage"));
hive.getConfig().setConfigDir(join(homeDir, ".hiveai", "config"));
await hive.getConfig().load();
await initORM(hive.getConfig().get("dataDir"));

const server = Deno.serve({ port: 0 }, createApp(hive).fetch);
const port = (server.addr as Deno.NetAddr).port;
try {
  Deno.writeTextFileSync(
    join(__dirname, "../frontend/.env"),
    `VITE_API_URL=http://localhost:${port}`,
  );
} catch {
  // Compiled (desktop) builds cannot write the dev .env file.
}

console.log(`\nBackend is running on http://localhost:${port}`);
openDesktopWindow(port);

hive.configure({
  model: hive.getConfig().get("model"),
  callbackBaseUrl: `http://localhost:${port}/api/external-plugin-callbacks`,
});

await loadPlugins();
