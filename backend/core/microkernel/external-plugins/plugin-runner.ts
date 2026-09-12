import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import type { BeeContext, BeePlugin } from "../bee-plugin.ts";

const REQUIRED_FIELDS = [
  "name",
  "description",
  "schema",
  "process",
  "selectionTests",
  "executionTests",
] as const;

const callbackBaseUrl = Deno.args[0] || "";

const loadedPlugins = new Map<string, BeePlugin>();

const callIdStorage = new AsyncLocalStorage<string | undefined>();

async function loadPluginModule(dir: string): Promise<BeePlugin> {
  const entryPoint = resolve(dir, "index.ts");
  const module = await import(pathToFileURL(entryPoint).href);

  if (typeof module.default !== "function") {
    throw new TypeError(
      "The module does not export a default class. Expected 'export default class ... implements BeePlugin'.",
    );
  }

  const instance: BeePlugin = new module.default();

  for (const field of REQUIRED_FIELDS) {
    if (!(field in instance)) {
      throw new TypeError(
        `The plugin does not fulfill the BeePlugin contract: missing '${field}'.`,
      );
    }
  }

  return instance;
}

function buildContext(pluginDir: string, pluginName: string): BeeContext {
  return {
    getDataDir: () => pluginDir,
    getModel: () => "",
    requestApproval: async (title, description, details) => {
      if (!callbackBaseUrl) return false;
      try {
        const res = await fetch(`${callbackBaseUrl}/request-approval`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pluginName, title, description, details }),
        });
        if (!res.ok) return false;
        const body = await res.json();
        return Boolean(body.data?.approved);
      } catch {
        return false;
      }
    },
    reportStep: (label) => {
      const callId = callIdStorage.getStore();
      if (!callbackBaseUrl || !callId) return;
      fetch(`${callbackBaseUrl}/report-step`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callId, label }),
      }).catch(() => {});
    },
  };
}

const server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean);

  if (segments[0] !== "plugins" || !segments[1]) {
    return new Response("Not found", { status: 404 });
  }
  const name = decodeURIComponent(segments[1]);
  const action = segments[2];

  if (!action && req.method === "DELETE") {
    loadedPlugins.delete(name);
    return Response.json({ success: true });
  }

  if (action === "load" && req.method === "POST") {
    try {
      const { dir } = await req.json();
      const plugin = await loadPluginModule(dir);
      await plugin.initialize(buildContext(dir, plugin.name));
      loadedPlugins.set(name, plugin);
      return Response.json({ success: true, name: plugin.name });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return Response.json({ error: detail }, { status: 400 });
    }
  }

  const plugin = loadedPlugins.get(name);
  if (!plugin) {
    return Response.json(
      { error: `Plugin '${name}' is not loaded.` },
      { status: 404 },
    );
  }

  if (action === "manifest" && req.method === "GET") {
    return Response.json({
      name: plugin.name,
      description: plugin.description,
      schema: z.toJSONSchema(plugin.schema),
      selectionTests: plugin.selectionTests,
      executionTests: plugin.executionTests.map((t) => ({
        description: t.description,
        kind: t.kind,
        params: t.params,
      })),
    });
  }

  if (action === "process" && req.method === "POST") {
    try {
      const body = await req.json();
      const input = body.input;
      const callId: string | undefined = body.callId;

      const parsed = plugin.schema.safeParse(input);
      if (!parsed.success) {
        return Response.json({
          error: `Invalid parameters: ${parsed.error.message}`,
        });
      }
      const result = await callIdStorage.run(callId, () =>
        plugin.process(parsed.data),
      );
      return Response.json({ result });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return Response.json({ error: detail }, { status: 500 });
    }
  }

  if (action === "execution-test" && req.method === "POST") {
    const { index } = await req.json();
    const testCase = plugin.executionTests[index];
    if (!testCase) {
      return Response.json({ error: "Test not found" }, { status: 404 });
    }
    try {
      const output = await plugin.process(testCase.params);
      return Response.json({
        success: testCase.expect(output),
        output,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return Response.json({ success: false, error: detail });
    }
  }

  return new Response("Not found", { status: 404 });
});

console.log(JSON.stringify({ port: server.addr.port }));
