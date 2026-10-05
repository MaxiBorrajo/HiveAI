import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "node:path";
import { SecretStore } from "./secret-store.ts";

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir();
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("SecretStore - put/get/delete round trip", async () => {
  await withTempDir(async (dir) => {
    const store = new SecretStore(dir);
    await store.put("a", "sk-ant-secret-AAAA");
    await store.put("b", "sk-ant-secret-BBBB");
    assertEquals(await store.get("a"), "sk-ant-secret-AAAA");
    assertEquals(await new SecretStore(dir).get("b"), "sk-ant-secret-BBBB");
    await store.delete("a");
    assertEquals(await store.get("a"), undefined);
    assertEquals(await store.get("b"), "sk-ant-secret-BBBB");
  });
});

Deno.test("SecretStore - plaintext never appears in any file", async () => {
  await withTempDir(async (dir) => {
    const store = new SecretStore(dir);
    await store.put("a", "sk-ant-PLAINTEXT-MARKER");
    for await (const entry of Deno.readDir(dir)) {
      const content = await Deno.readTextFile(join(dir, entry.name));
      assert(!content.includes("PLAINTEXT-MARKER"), entry.name);
    }
  });
});

Deno.test("SecretStore - master key file is 0600", async () => {
  if (Deno.build.os === "windows") return;
  await withTempDir(async (dir) => {
    await new SecretStore(dir).put("a", "x");
    const info = await Deno.stat(join(dir, ".master.key"));
    assertEquals(info.mode! & 0o777, 0o600);
  });
});

Deno.test("SecretStore - concurrent writes are not lost", async () => {
  await withTempDir(async (dir) => {
    const store = new SecretStore(dir);
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => store.put(`k${i}`, `v${i}`)),
    );
    for (let i = 0; i < 10; i++) assertEquals(await store.get(`k${i}`), `v${i}`);
  });
});

Deno.test("SecretStore - tampered file fails to decrypt", async () => {
  await withTempDir(async (dir) => {
    const store = new SecretStore(dir);
    await store.put("a", "secret");
    const path = join(dir, "secrets.enc");
    const payload = JSON.parse(await Deno.readTextFile(path));
    payload.data = payload.data.replace(/.$/, payload.data.endsWith("A") ? "B" : "A");
    await Deno.writeTextFile(path, JSON.stringify(payload));
    await assertRejects(() => new SecretStore(dir).get("a"));
  });
});
