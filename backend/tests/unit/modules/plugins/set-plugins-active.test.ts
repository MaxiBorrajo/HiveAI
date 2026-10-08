import { assert, assertEquals, assertFalse } from "@std/assert";
import { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import CounterPlugin from "../../../../plugins/counter/index.ts";
import { setPluginsActive } from "../../../../modules/plugins/use-cases/set-plugins-active.ts";

async function makeHiveWithTwoPlugins() {
  const tempDir = await Deno.makeTempDir();
  const hive = new HiveMicrokernel();
  hive.configure({ dataDir: tempDir });
  await hive.register(new CounterPlugin());

  const second = new CounterPlugin();
  second.name = "counter-2";
  await hive.register(second);

  return { hive, tempDir };
}

Deno.test("setPluginsActive rolls back already-applied changes when a later change fails", async () => {
  const { hive, tempDir } = await makeHiveWithTwoPlugins();
  try {
    // Simulate a mid-batch failure: 'counter' succeeds first, then a plugin
    // that isn't registered fails, forcing a rollback of 'counter'.
    const result = await setPluginsActive(hive, [
      { name: "counter", active: true },
      { name: "does-not-exist", active: true },
    ]);

    assertFalse(result.ok);
    if (!result.ok) {
      assertEquals(result.failedPlugin, "does-not-exist");
    }

    // The state must be consistent with pre-batch state: nothing partially applied.
    assertFalse(hive.isActive("counter"));
    assertFalse(hive.isActive("does-not-exist"));
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("setPluginsActive rolls back a deactivation followed by a failing activation", async () => {
  const { hive, tempDir } = await makeHiveWithTwoPlugins();
  try {
    await hive.activate("counter");

    const result = await setPluginsActive(hive, [
      { name: "counter", active: false },
      { name: "does-not-exist", active: true },
    ]);

    assertFalse(result.ok);
    // 'counter' was deactivated then must be rolled back to active.
    assert(hive.isActive("counter"));
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("setPluginsActive applies all changes when every change succeeds", async () => {
  const { hive, tempDir } = await makeHiveWithTwoPlugins();
  try {
    const result = await setPluginsActive(hive, [
      { name: "counter", active: true },
      { name: "counter-2", active: true },
    ]);

    assert(result.ok);
    assert(hive.isActive("counter"));
    assert(hive.isActive("counter-2"));
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("setPluginsActive with an empty changes array applies nothing and reports success", async () => {
  const { hive, tempDir } = await makeHiveWithTwoPlugins();
  try {
    const result = await setPluginsActive(hive, []);

    assert(result.ok);
    assertFalse(hive.isActive("counter"));
    assertFalse(hive.isActive("counter-2"));
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
