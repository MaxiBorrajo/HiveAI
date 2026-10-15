import { assert, assertEquals, assertRejects } from "@std/assert";
import { SecretStore } from "../../../../core/secrets/secret-store.ts";
import { AppError } from "../../../../core/api/errors.ts";
import type { BeePlugin } from "../../../../core/microkernel/bee-plugin.ts";
import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import type { PluginConfigRow } from "../../../../infrastructure/db/schema/index.ts";
import type { PluginConfigRepository } from "../../../../infrastructure/db/repositories/plugin-config-repository.ts";
import type { PluginConfigDeps } from "../../../../modules/plugin-config/types.ts";
import {
  configId,
  getPluginConfig,
} from "../../../../modules/plugin-config/use-cases/get-plugin-config.ts";
import { setPluginConfig } from "../../../../modules/plugin-config/use-cases/set-plugin-config.ts";
import { deletePluginConfig } from "../../../../modules/plugin-config/use-cases/delete-plugin-config.ts";

class FakeRepo {
  rows = new Map<string, PluginConfigRow>();

  findByPlugin(pluginName: string) {
    return Promise.resolve(
      [...this.rows.values()].filter((r) => r.pluginName === pluginName),
    );
  }
  findOne(pluginName: string, key: string) {
    return Promise.resolve(
      [...this.rows.values()].find(
        (r) => r.pluginName === pluginName && r.key === key,
      ),
    );
  }
  upsert(row: PluginConfigRow) {
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }
  delete(id: string) {
    this.rows.delete(id);
    return Promise.resolve();
  }
}

function fakePlugin(overrides: Partial<BeePlugin> = {}): BeePlugin {
  return {
    name: "web_search",
    description: "test plugin",
    schema: {} as BeePlugin["schema"],
    selectionTests: [],
    executionTests: [],
    initialize: () => {},
    process: () => Promise.resolve(""),
    configFields: [
      { key: "SEARXNG_INSTANCE_URL", label: "SearXNG instance URL", secret: false },
      { key: "SOME_API_KEY", label: "Some API key", secret: true },
    ],
    ...overrides,
  };
}

async function setup(plugin: BeePlugin | undefined = fakePlugin()) {
  const dir = await Deno.makeTempDir();
  const secrets = new SecretStore(dir);
  const repo = new FakeRepo();
  const hive = {
    getPlugin: (name: string) => (plugin?.name === name ? plugin : undefined),
  } as unknown as HiveMicrokernel;
  const deps: PluginConfigDeps = {
    repo: repo as unknown as PluginConfigRepository,
    secrets,
    hive,
  };
  return { deps, secrets, repo, dir };
}

Deno.test("plugin config - a plugin with no configFields returns an empty list", async () => {
  const { deps, dir } = await setup(fakePlugin({ configFields: undefined }));
  const fields = await getPluginConfig(deps, "web_search");
  assertEquals(fields, []);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("plugin config - unconfigured fields come back with null masked/value", async () => {
  const { deps, dir } = await setup();
  const fields = await getPluginConfig(deps, "web_search");
  assertEquals(fields.length, 2);
  assert(fields.every((f) => f.masked === null && f.value === null));
  await Deno.remove(dir, { recursive: true });
});

Deno.test("plugin config - setting a non-secret field stores it in SecretStore and returns it in clear", async () => {
  const { deps, secrets, dir } = await setup();
  await setPluginConfig(deps, "web_search", "SEARXNG_INSTANCE_URL", "https://searx.example.com");

  assertEquals(
    await secrets.get(configId("web_search", "SEARXNG_INSTANCE_URL")),
    "https://searx.example.com",
  );

  const fields = await getPluginConfig(deps, "web_search");
  const url = fields.find((f) => f.key === "SEARXNG_INSTANCE_URL")!;
  assertEquals(url.value, "https://searx.example.com");
  assertEquals(url.masked, null);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("plugin config - setting a secret field never surfaces the raw value, only a mask", async () => {
  const { deps, dir } = await setup();
  await setPluginConfig(deps, "web_search", "SOME_API_KEY", "sk-abcd1234");

  const fields = await getPluginConfig(deps, "web_search");
  const key = fields.find((f) => f.key === "SOME_API_KEY")!;
  assertEquals(key.value, null);
  assertEquals(key.masked, "••••1234");
  assert(!JSON.stringify(fields).includes("sk-abcd1234"));
  await Deno.remove(dir, { recursive: true });
});

Deno.test("plugin config - rejects a key the plugin never declared", async () => {
  const { deps, repo, dir } = await setup();
  await assertRejects(
    () => setPluginConfig(deps, "web_search", "NOT_A_REAL_KEY", "value"),
    AppError,
  );
  assertEquals(repo.rows.size, 0);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("plugin config - rejects an empty value", async () => {
  const { deps, dir } = await setup();
  await assertRejects(
    () => setPluginConfig(deps, "web_search", "SEARXNG_INSTANCE_URL", "   "),
    AppError,
  );
  await Deno.remove(dir, { recursive: true });
});

Deno.test("plugin config - operating on an unregistered plugin fails clearly", async () => {
  const { deps, dir } = await setup(undefined);
  await assertRejects(() => getPluginConfig(deps, "ghost_plugin"), AppError);
  await assertRejects(
    () => setPluginConfig(deps, "ghost_plugin", "X", "y"),
    AppError,
  );
  await assertRejects(
    () => deletePluginConfig(deps, "ghost_plugin", "X"),
    AppError,
  );
  await Deno.remove(dir, { recursive: true });
});

Deno.test("plugin config - deleting a value clears both the secret and the row", async () => {
  const { deps, secrets, repo, dir } = await setup();
  await setPluginConfig(deps, "web_search", "SEARXNG_INSTANCE_URL", "https://searx.example.com");
  assertEquals(repo.rows.size, 1);

  await deletePluginConfig(deps, "web_search", "SEARXNG_INSTANCE_URL");

  assertEquals(repo.rows.size, 0);
  assertEquals(
    await secrets.get(configId("web_search", "SEARXNG_INSTANCE_URL")),
    undefined,
  );
  const fields = await getPluginConfig(deps, "web_search");
  const url = fields.find((f) => f.key === "SEARXNG_INSTANCE_URL")!;
  assertEquals(url.value, null);
  await Deno.remove(dir, { recursive: true });
});

Deno.test("plugin config - config is isolated per plugin (same key name, different plugins)", async () => {
  const dir = await Deno.makeTempDir();
  const secrets = new SecretStore(dir);
  const repo = new FakeRepo();
  const pluginA = fakePlugin({
    name: "plugin_a",
    configFields: [{ key: "API_KEY", label: "API key", secret: true }],
  });
  const pluginB = fakePlugin({
    name: "plugin_b",
    configFields: [{ key: "API_KEY", label: "API key", secret: true }],
  });
  const hive = {
    getPlugin: (name: string) =>
      ({ plugin_a: pluginA, plugin_b: pluginB })[name],
  } as unknown as HiveMicrokernel;
  const deps: PluginConfigDeps = {
    repo: repo as unknown as PluginConfigRepository,
    secrets,
    hive,
  };

  await setPluginConfig(deps, "plugin_a", "API_KEY", "key-for-a");
  await setPluginConfig(deps, "plugin_b", "API_KEY", "key-for-b");

  assertEquals(await secrets.get(configId("plugin_a", "API_KEY")), "key-for-a");
  assertEquals(await secrets.get(configId("plugin_b", "API_KEY")), "key-for-b");

  await deletePluginConfig(deps, "plugin_a", "API_KEY");
  assertEquals(await secrets.get(configId("plugin_a", "API_KEY")), undefined);
  assertEquals(await secrets.get(configId("plugin_b", "API_KEY")), "key-for-b");

  await Deno.remove(dir, { recursive: true });
});
