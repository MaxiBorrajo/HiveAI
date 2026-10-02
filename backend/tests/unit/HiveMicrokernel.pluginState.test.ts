import { assert, assertFalse } from "@std/assert";
import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { initORM } from "../../infrastructure/db/orm.ts";
import { PluginStateRepository } from "../../infrastructure/db/repositories/plugin-state-repository.ts";
import CounterPlugin from "../../plugins/counter/index.ts";

async function makeHive(pluginName: string) {
  const tempDir = await Deno.makeTempDir();
  const db = await initORM(tempDir);
  const repository = new PluginStateRepository(db);

  const hive = new HiveMicrokernel();
  hive.configure({ dataDir: tempDir });
  hive.setPluginStateRepository(repository);

  const plugin = new CounterPlugin();
  plugin.name = pluginName;
  await hive.register(plugin);

  return { hive, repository, tempDir, pluginName };
}

Deno.test("activate() persists the active state so it survives a fresh HiveMicrokernel instance", async () => {
  const { hive, repository, pluginName } = await makeHive("persist-activate");

  await hive.activate(pluginName);

  const persisted = await repository.findAll();
  assert(persisted.get(pluginName));
});

Deno.test("deactivate() persists the inactive state", async () => {
  const { hive, repository, pluginName } = await makeHive("persist-deactivate");

  await hive.activate(pluginName);
  await hive.deactivate(pluginName);

  const persisted = await repository.findAll();
  assertFalse(persisted.get(pluginName));
});

Deno.test("restorePersistedActiveStates() re-activates a plugin that was persisted as active on a fresh instance (simulated restart)", async () => {
  const { repository, pluginName, tempDir } = await makeHive(
    "restart-reactivate",
  );

  // Simulate: user activated the plugin in a previous run.
  await repository.setActive(pluginName, true);

  // Simulate a backend restart: brand new HiveMicrokernel instance, plugin
  // registered fresh (defaults to inactive), same underlying repository/DB.
  const restarted = new HiveMicrokernel();
  restarted.configure({ dataDir: tempDir });
  restarted.setPluginStateRepository(repository);
  const plugin = new CounterPlugin();
  plugin.name = pluginName;
  await restarted.register(plugin);

  assertFalse(restarted.isActive(pluginName));
  await restarted.restorePersistedActiveStates();
  assert(restarted.isActive(pluginName));
});

Deno.test("restorePersistedActiveStates() deactivates a plugin that was persisted as inactive, overriding the default-active startup state", async () => {
  const { hive, repository, pluginName, tempDir } = await makeHive(
    "restart-deactivate",
  );

  // Internal plugins default to active on startup.
  await hive.activate(pluginName);
  // User explicitly deactivated it.
  await hive.deactivate(pluginName);

  // Simulate a backend restart. Startup (main.ts) must consult the
  // persisted state before defaulting internal plugins to active, otherwise
  // it would overwrite the persisted `false` with `true` before
  // restorePersistedActiveStates() ever runs.
  const restarted = new HiveMicrokernel();
  restarted.configure({ dataDir: tempDir });
  restarted.setPluginStateRepository(repository);
  const plugin = new CounterPlugin();
  plugin.name = pluginName;
  await restarted.register(plugin);

  const persisted = await restarted.getPersistedActiveState(pluginName);
  if (persisted !== false) {
    await restarted.activate(pluginName); // default startup behavior
  }

  assertFalse(restarted.isActive(pluginName));
  await restarted.restorePersistedActiveStates();
  assertFalse(restarted.isActive(pluginName));
});

Deno.test("startup default-activation does not clobber a persisted 'false' before restorePersistedActiveStates runs", async () => {
  const { repository, pluginName, tempDir } = await makeHive(
    "startup-guard",
  );

  // User previously deactivated the plugin; persisted state says inactive.
  await repository.setActive(pluginName, false);

  const restarted = new HiveMicrokernel();
  restarted.configure({ dataDir: tempDir });
  restarted.setPluginStateRepository(repository);
  const plugin = new CounterPlugin();
  plugin.name = pluginName;
  await restarted.register(plugin);

  // Mirrors main.ts's loadPlugins(): consult persisted state before
  // defaulting to active.
  const persisted = await restarted.getPersistedActiveState(pluginName);
  if (persisted !== false) {
    await restarted.activate(pluginName);
  }

  assertFalse(restarted.isActive(pluginName));

  const stillPersistedFalse = await repository.findAll();
  assertFalse(stillPersistedFalse.get(pluginName));
});

Deno.test("forgetPersistedState() removes the row so a re-imported plugin with the same name starts fresh", async () => {
  const { hive, repository, pluginName } = await makeHive("forget-state");

  await hive.activate(pluginName);
  assert((await repository.findAll()).has(pluginName));

  await hive.forgetPersistedState(pluginName);
  assertFalse((await repository.findAll()).has(pluginName));
});
