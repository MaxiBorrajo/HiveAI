import { assert, assertEquals, assertFalse } from "@std/assert";
import { Hono } from "hono";
import { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import CounterPlugin from "../../plugins/counter/index.ts";
import { pluginsRouter } from "../../modules/plugins/router.ts";

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

  return { app, hive, tempDir };
}

Deno.test("POST /api/plugins/:name/deactivate deactivates an active plugin", async () => {
  const { app, hive, tempDir } = await makeTestApp();
  try {
    await hive.activate("counter");

    const res = await app.request("/api/plugins/counter/deactivate", {
      method: "POST",
    });
    assertEquals(res.status, 200);

    const body = await res.json();
    assert(body.success);
    assertFalse(hive.isActive("counter"));
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("POST /api/plugins/:name/deactivate returns 404 for a plugin that was never active", async () => {
  const { app, tempDir } = await makeTestApp();
  try {
    // 'counter' is registered but never activated.
    const res = await app.request("/api/plugins/counter/deactivate", {
      method: "POST",
    });
    assertEquals(res.status, 404);

    const body = await res.json();
    assertFalse(body.success);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("POST /api/plugins/:name/deactivate returns 404 for an unknown plugin", async () => {
  const { app, tempDir } = await makeTestApp();
  try {
    const res = await app.request("/api/plugins/does-not-exist/deactivate", {
      method: "POST",
    });
    assertEquals(res.status, 404);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
