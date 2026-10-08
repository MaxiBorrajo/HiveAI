import { assert, assertEquals, assertFalse } from "@std/assert";
import { Hono } from "hono";
import { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { draftsRouter } from "../../../../modules/drafts/router.ts";

async function makeTestApp() {
  const tempDir = await Deno.makeTempDir();
  const hive = new HiveMicrokernel();
  hive.configure({ dataDir: tempDir });

  const app = new Hono<{ Variables: { hive: HiveMicrokernel } }>();
  app.use("*", async (c, next) => {
    c.set("hive", hive);
    await next();
  });
  app.route("/api/drafts", draftsRouter);

  return { app, tempDir };
}

async function createDraft(
  app: Hono<{ Variables: { hive: HiveMicrokernel } }>,
  name: string,
) {
  return app.request("/api/drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

Deno.test("POST /api/drafts creates a draft with a valid name and scaffolds its files", async () => {
  const { app, tempDir } = await makeTestApp();
  try {
    const res = await createDraft(app, "my_plugin");
    assertEquals(res.status, 200);

    const body = await res.json();
    assert(body.success);
    assertEquals(body.data.name, "my_plugin");

    const filesRes = await app.request("/api/drafts/my_plugin/files");
    const filesBody = await filesRes.json();
    assert(filesBody.success);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("POST /api/drafts rejects a name that does not match the naming convention", async () => {
  const { app, tempDir } = await makeTestApp();
  try {
    const res = await createDraft(app, "Invalid Name!");
    assertEquals(res.status, 400);

    const body = await res.json();
    assertFalse(body.success);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("POST /api/drafts rejects a duplicate draft name with 409", async () => {
  const { app, tempDir } = await makeTestApp();
  try {
    await createDraft(app, "duplicate-plugin");
    const res = await createDraft(app, "duplicate-plugin");
    assertEquals(res.status, 409);

    const body = await res.json();
    assertFalse(body.success);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("GET /api/drafts lists created drafts", async () => {
  const { app, tempDir } = await makeTestApp();
  try {
    await createDraft(app, "listed-plugin");
    const res = await app.request("/api/drafts");
    assertEquals(res.status, 200);

    const body = await res.json();
    assert(body.success);
    assertEquals(body.data.drafts.length, 1);
    assertEquals(body.data.drafts[0].name, "listed-plugin");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("PUT /api/drafts/:name/files saves editable file content", async () => {
  const { app, tempDir } = await makeTestApp();
  try {
    await createDraft(app, "editable-plugin");

    const res = await app.request("/api/drafts/editable-plugin/files", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        file: "index.ts",
        content: "// edited content",
      }),
    });
    assertEquals(res.status, 200);

    const body = await res.json();
    assert(body.success);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("PUT /api/drafts/:name/files rejects a file outside the editable whitelist", async () => {
  const { app, tempDir } = await makeTestApp();
  try {
    await createDraft(app, "protected-plugin");

    const res = await app.request("/api/drafts/protected-plugin/files", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        file: "bee-plugin.ts", // not in EDITABLE_FILES
        content: "// should not be allowed",
      }),
    });
    assertEquals(res.status, 400);

    const body = await res.json();
    assertFalse(body.success);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("PUT /api/drafts/:name/files returns 404 for a draft that does not exist", async () => {
  const { app, tempDir } = await makeTestApp();
  try {
    const res = await app.request("/api/drafts/does-not-exist/files", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: "index.ts", content: "x" }),
    });
    assertEquals(res.status, 404);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("POST /api/drafts/:name/validate reports quality issues for a freshly scaffolded (empty) draft", async () => {
  const { app, tempDir } = await makeTestApp();
  try {
    await createDraft(app, "unfinished-plugin");

    const res = await app.request(
      "/api/drafts/unfinished-plugin/validate",
      { method: "POST" },
    );
    assertEquals(res.status, 200);

    const body = await res.json();
    assert(body.success);
    // A freshly scaffolded draft has no selection/execution tests yet, so
    // it must NOT pass quality validation.
    assertFalse(body.data.valid);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("DELETE /api/drafts/:name removes an existing draft", async () => {
  const { app, tempDir } = await makeTestApp();
  try {
    await createDraft(app, "removable-plugin");

    const res = await app.request("/api/drafts/removable-plugin", {
      method: "DELETE",
    });
    assertEquals(res.status, 200);

    const listRes = await app.request("/api/drafts");
    const listBody = await listRes.json();
    assertEquals(listBody.data.drafts.length, 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("DELETE /api/drafts/:name returns 404 for a draft that does not exist", async () => {
  const { app, tempDir } = await makeTestApp();
  try {
    const res = await app.request("/api/drafts/does-not-exist", {
      method: "DELETE",
    });
    assertEquals(res.status, 404);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
