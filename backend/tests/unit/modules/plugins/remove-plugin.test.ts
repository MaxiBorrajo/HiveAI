import { assertEquals, assertFalse } from "@std/assert";
import { Hono } from "hono";
import { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import CounterPlugin from "../../../../plugins/counter/index.ts";
import { pluginsRouter } from "../../../../modules/plugins/router.ts";

async function makeTestApp() {
  const tempDir = await Deno.makeTempDir();
  const hive = new HiveMicrokernel();
  hive.configure({ dataDir: tempDir });
  await hive.register(new CounterPlugin());

  const app = new Hono<{ Variables: { hive: HiveMicrokernel } }>();
  app.use("*", async (c, next) => {
    c.set("hive", hive);
    await next();
  });
  app.route("/api/plugins", pluginsRouter);

  return { app, tempDir };
}

Deno.test("DELETE /api/plugins/:name returns 404 for an internal (non-external) plugin", async () => {
  const { app, tempDir } = await makeTestApp();
  try {
    // 'counter' is an internal plugin, not imported/external — must be rejected.
    const res = await app.request("/api/plugins/counter", {
      method: "DELETE",
    });
    assertEquals(res.status, 404);

    const body = await res.json();
    assertFalse(body.success);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("DELETE /api/plugins/:name returns 404 for a plugin that was never registered", async () => {
  const { app, tempDir } = await makeTestApp();
  try {
    const res = await app.request("/api/plugins/does-not-exist", {
      method: "DELETE",
    });
    assertEquals(res.status, 404);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
