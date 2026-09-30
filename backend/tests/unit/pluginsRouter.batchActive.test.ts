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

  const second = new CounterPlugin();
  second.name = "counter-2";
  await hive.register(second);

  const app = new Hono<{ Variables: { hive: HiveMicrokernel } }>();
  app.use("*", async (c, next) => {
    c.set("hive", hive);
    await next();
  });
  app.route("/api/plugins", pluginsRouter);

  return { app, hive, tempDir };
}

Deno.test("POST /api/plugins/batch-active activates every plugin in the batch", async () => {
  const { app, hive, tempDir } = await makeTestApp();
  try {
    const res = await app.request("/api/plugins/batch-active", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        changes: [
          { name: "counter", active: true },
          { name: "counter-2", active: true },
        ],
      }),
    });
    assertEquals(res.status, 200);

    const body = await res.json();
    assert(body.success);
    assert(hive.isActive("counter"));
    assert(hive.isActive("counter-2"));

    const returnedNames = body.data.map((p: { name: string }) => p.name);
    assert(returnedNames.includes("counter"));
    assert(returnedNames.includes("counter-2"));
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("POST /api/plugins/batch-active rolls back and returns 409 with consistent state on a mid-batch failure", async () => {
  const { app, hive, tempDir } = await makeTestApp();
  try {
    const res = await app.request("/api/plugins/batch-active", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        changes: [
          { name: "counter", active: true },
          { name: "does-not-exist", active: true },
        ],
      }),
    });
    assertEquals(res.status, 409);

    const body = await res.json();
    assertFalse(body.success);

    // Server-side state was rolled back: 'counter' must not be active.
    assertFalse(hive.isActive("counter"));

    // The response's reported plugin list must match the actual server state
    // (no partial-failure state leaked to the client).
    const counterEntry = body.data.find(
      (p: { name: string }) => p.name === "counter",
    );
    assertEquals(counterEntry.active, false);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("POST /api/plugins/batch-active returns 400 when no changes are provided", async () => {
  const { app, tempDir } = await makeTestApp();
  try {
    const res = await app.request("/api/plugins/batch-active", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ changes: [] }),
    });
    assertEquals(res.status, 400);

    const body = await res.json();
    assertFalse(body.success);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("POST /api/plugins/batch-active returns 400 for a malformed body", async () => {
  const { app, tempDir } = await makeTestApp();
  try {
    const res = await app.request("/api/plugins/batch-active", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    assertEquals(res.status, 400);

    const body = await res.json();
    assertFalse(body.success);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
