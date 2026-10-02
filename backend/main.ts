import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HiveMicrokernel } from "./core/microkernel/hive-microkernel.ts";
import { initORM } from "./infrastructure/db/orm.ts";
import { PluginStateRepository } from "./infrastructure/db/repositories/plugin-state-repository.ts";
import { homeDir } from "./core/env.ts";
import { createApp } from "./bootstrap/create-app.ts";
import { openDesktopWindow } from "./bootstrap/desktop.ts";
import { loadPlugins } from "./bootstrap/load-plugins.ts";
import { startAutoUpdate } from "./bootstrap/auto-update.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const hive = HiveMicrokernel.getInstance();

hive.getConfig().setDataDir(join(homeDir, ".hiveai", "storage"));
hive.getConfig().setConfigDir(join(homeDir, ".hiveai", "config"));
await hive.getConfig().load();
const db = await initORM(hive.getConfig().get("dataDir"));
hive.setPluginStateRepository(new PluginStateRepository(db));

const server = Deno.serve({ port: 0 }, createApp(hive).fetch);
const port = (server.addr as Deno.NetAddr).port;
try {
  Deno.writeTextFileSync(
    join(__dirname, "../frontend/.env"),
    `VITE_API_URL=http://localhost:${port}`,
  );
} catch {
}

console.log(`\nBackend is running on http://localhost:${port}`);
openDesktopWindow(port);
startAutoUpdate();

hive.configure({
  model: hive.getConfig().get("model"),
  callbackBaseUrl: `http://localhost:${port}/api/external-plugin-callbacks`,
});

await loadPlugins(hive, join(__dirname, "plugins"));
