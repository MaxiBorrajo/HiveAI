import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HiveMicrokernel } from "./core/microkernel/hive-microkernel.ts";
import { initORM } from "./infrastructure/db/orm.ts";
import { PluginStateRepository } from "./infrastructure/db/repositories/plugin-state-repository.ts";
import { homeDir } from "./core/env.ts";
import { getSecretStore } from "./core/secrets/index.ts";
import {
  setKeyAliasResolver,
  setSecretResolver,
} from "./core/ai/providers/create-chat-model.ts";
import { setUsageRecorder } from "./core/ai/usage/usage-recorder.ts";
import { ApiKeyRepository } from "./infrastructure/db/repositories/api-key-repository.ts";
import { ModelUsageRepository } from "./infrastructure/db/repositories/model-usage-repository.ts";
import { createApp } from "./bootstrap/create-app.ts";
import { openDesktopWindow } from "./bootstrap/desktop.ts";
import { loadPlugins } from "./bootstrap/load-plugins.ts";

// A provider SDK can reject a stream promise nobody awaits (e.g. Google's
// "Failed to parse stream"); without this Deno exits and takes the backend down.
globalThis.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  console.error("[Unhandled rejection]", event.reason);
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const hive = HiveMicrokernel.getInstance();

hive.getConfig().setDataDir(join(homeDir, ".hiveai", "storage"));
hive.getConfig().setConfigDir(join(homeDir, ".hiveai", "config"));
await hive.getConfig().load();
const db = await initORM(hive.getConfig().get("dataDir"));
hive.setPluginStateRepository(new PluginStateRepository(db));
setSecretResolver((keyId) => getSecretStore().get(keyId));
const apiKeyRepository = new ApiKeyRepository(db);
setKeyAliasResolver(async (keyId) => (await apiKeyRepository.findById(keyId))?.alias);
setUsageRecorder(new ModelUsageRepository(db));

const server = Deno.serve({ port: 0 }, createApp(hive).fetch);
const port = (server.addr as Deno.NetAddr).port;
try {
  Deno.writeTextFileSync(
    join(__dirname, "../frontend/.env"),
    `VITE_API_URL=http://localhost:${port}`,
  );
} catch {
}

console.log(`\nBackend is running on http://localhost:${port} `);
openDesktopWindow(port);

hive.configure({
  model: hive.getConfig().get("model"),
  callbackBaseUrl: `http://localhost:${port}/api/external-plugin-callbacks`,
});

await loadPlugins(hive, join(__dirname, "plugins"));
