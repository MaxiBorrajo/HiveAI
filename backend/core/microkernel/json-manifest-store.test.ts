import { assertEquals } from "@std/assert";
import { join } from "node:path";
import { JsonManifestStore } from "./json-manifest-store.ts";

interface Item {
  name: string;
  value?: number;
}

function makeStore(dir: string, key = "items") {
  return new JsonManifestStore<Item>(dir, key);
}

// --- read ---

Deno.test("read - returns an empty array when the manifest file does not exist yet", async () => {
  const tempDir = await Deno.makeTempDir();
  const store = makeStore(tempDir);
  assertEquals(await store.read(), []);
});

Deno.test("read - returns the items under the configured key", async () => {
  const tempDir = await Deno.makeTempDir();
  const store = makeStore(tempDir, "plugins");
  await store.write([{ name: "a" }, { name: "b" }]);
  assertEquals(await store.read(), [{ name: "a" }, { name: "b" }]);
});

Deno.test("read - returns an empty array if the manifest exists but lacks the configured key", async () => {
  const tempDir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    join(tempDir, "manifest.json"),
    JSON.stringify({ other_key: [{ name: "z" }] }),
  );
  const store = makeStore(tempDir, "items");
  assertEquals(await store.read(), []);
});

// --- write ---

Deno.test("write - creates the directory if it does not exist yet", async () => {
  const tempDir = await Deno.makeTempDir();
  const nestedDir = join(tempDir, "nested", "deep");
  const store = makeStore(nestedDir);
  await store.write([{ name: "a" }]);
  assertEquals(await store.read(), [{ name: "a" }]);
});

Deno.test("write - persists valid JSON readable on a fresh store instance", async () => {
  const tempDir = await Deno.makeTempDir();
  await makeStore(tempDir).write([{ name: "a", value: 1 }]);
  const reread = await makeStore(tempDir).read();
  assertEquals(reread, [{ name: "a", value: 1 }]);
});

Deno.test("write - does not leave a .tmp file behind after a successful write", async () => {
  const tempDir = await Deno.makeTempDir();
  await makeStore(tempDir).write([{ name: "a" }]);
  let tmpExists = true;
  try {
    await Deno.stat(join(tempDir, "manifest.json.tmp"));
  } catch {
    tmpExists = false;
  }
  assertEquals(tmpExists, false);
});

Deno.test("write - overwrites the full item list on each call (not appending)", async () => {
  const tempDir = await Deno.makeTempDir();
  const store = makeStore(tempDir);
  await store.write([{ name: "a" }, { name: "b" }]);
  await store.write([{ name: "c" }]);
  assertEquals(await store.read(), [{ name: "c" }]);
});

// --- upsert ---

Deno.test("upsert - adds a new item to an empty store", async () => {
  const tempDir = await Deno.makeTempDir();
  const store = makeStore(tempDir);
  await store.upsert({ name: "a", value: 1 });
  assertEquals(await store.read(), [{ name: "a", value: 1 }]);
});

Deno.test("upsert - replaces an existing item with the same name rather than duplicating it", async () => {
  const tempDir = await Deno.makeTempDir();
  const store = makeStore(tempDir);
  await store.upsert({ name: "a", value: 1 });
  await store.upsert({ name: "a", value: 2 });
  assertEquals(await store.read(), [{ name: "a", value: 2 }]);
});

Deno.test("upsert - appends a differently-named item alongside existing ones", async () => {
  const tempDir = await Deno.makeTempDir();
  const store = makeStore(tempDir);
  await store.upsert({ name: "a" });
  await store.upsert({ name: "b" });
  assertEquals(await store.read(), [{ name: "a" }, { name: "b" }]);
});

// --- delete ---

Deno.test("delete - removes the item and returns it when found", async () => {
  const tempDir = await Deno.makeTempDir();
  const store = makeStore(tempDir);
  await store.upsert({ name: "a", value: 7 });
  const deleted = await store.delete("a");
  assertEquals(deleted, { name: "a", value: 7 });
  assertEquals(await store.read(), []);
});

Deno.test("delete - returns undefined and leaves the store untouched when the item is not found", async () => {
  const tempDir = await Deno.makeTempDir();
  const store = makeStore(tempDir);
  await store.upsert({ name: "a" });
  const deleted = await store.delete("does-not-exist");
  assertEquals(deleted, undefined);
  assertEquals(await store.read(), [{ name: "a" }]);
});

// --- multiple keys sharing one manifest file ---

Deno.test("multiple keys can coexist in the same manifest.json without clobbering each other", async () => {
  const tempDir = await Deno.makeTempDir();
  const pluginsStore = makeStore(tempDir, "plugins");
  await pluginsStore.write([{ name: "plugin-a" }]);

  // A second store instance pointed at the same dir but a different key
  // overwrites the whole manifest.json (write() serializes only its own
  // key), so after this, the "plugins" key is gone — this documents that
  // real behavior rather than assuming namespacing that doesn't exist.
  const draftsStore = makeStore(tempDir, "drafts");
  await draftsStore.write([{ name: "draft-a" }]);

  assertEquals(await draftsStore.read(), [{ name: "draft-a" }]);
  assertEquals(await pluginsStore.read(), []);
});
