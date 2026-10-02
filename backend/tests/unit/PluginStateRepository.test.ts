import { assertEquals } from "@std/assert";
import { initORM } from "../../infrastructure/db/orm.ts";
import { PluginStateRepository } from "../../infrastructure/db/repositories/plugin-state-repository.ts";

async function makeRepository() {
  const tempDir = await Deno.makeTempDir();
  const db = await initORM(tempDir);
  return { repository: new PluginStateRepository(db), tempDir };
}

Deno.test("PluginStateRepository.findAll returns an empty map when nothing was persisted", async () => {
  const { repository } = await makeRepository();
  const all = await repository.findAll();
  assertEquals(all.size, 0);
});

Deno.test("PluginStateRepository.setActive inserts a new row", async () => {
  const { repository } = await makeRepository();
  await repository.setActive("plugin-insert", true);

  const all = await repository.findAll();
  assertEquals(all.get("plugin-insert"), true);
});

Deno.test("PluginStateRepository.setActive updates an existing row instead of duplicating it", async () => {
  const { repository } = await makeRepository();
  await repository.setActive("plugin-update", false);
  await repository.setActive("plugin-update", true);

  const all = await repository.findAll();
  assertEquals(all.get("plugin-update"), true);
  assertEquals(
    [...all.keys()].filter((name) => name === "plugin-update").length,
    1,
  );
});

Deno.test("PluginStateRepository.delete removes the persisted row", async () => {
  const { repository } = await makeRepository();
  await repository.setActive("plugin-delete", true);
  await repository.delete("plugin-delete");

  const all = await repository.findAll();
  assertEquals(all.has("plugin-delete"), false);
});

Deno.test("PluginStateRepository.delete is a no-op for a name that was never persisted", async () => {
  const { repository } = await makeRepository();
  await repository.delete("never-existed");

  const all = await repository.findAll();
  assertEquals(all.has("never-existed"), false);
});
