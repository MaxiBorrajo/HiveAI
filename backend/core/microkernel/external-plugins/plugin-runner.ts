// Runs as an interpreted (never compiled) Deno subprocess — the one piece
// of the system that can still do a real dynamic import() of a path unknown
// at build time. The compiled/packaged main app can't, because `deno
// compile`/`deno desktop` only bundle statically-analyzable imports. See
// external-plugin-host.ts's header comment for the full rationale.
//
// Usage: deno run --allow-read --allow-net --allow-env plugin-runner.ts [callbackBaseUrl]
//
// A single instance of this process serves every active external plugin,
// not just one — HiveMicrokernel starts exactly one of these (see
// external-plugin-host.ts) the first time any external plugin is activated,
// and keeps it running (loading/unloading plugins into it on demand) for as
// long as at least one external plugin is active. Running N plugins in N
// separate `deno run` processes was wasteful: an idle Deno/V8 process has a
// real memory floor, and it adds up fast once someone has several external
// plugins turned on. The tradeoff: a crash or infinite loop in one plugin's
// code can now take every other active external plugin down with it,
// because they all share this one process. See the README for the decision.
//
// Loads each BeePlugin the same way HiveMicrokernel.loadAndRegister does
// for built-in plugins, then serves all of them over HTTP on one
// OS-assigned port, namespaced by plugin name:
//   POST   /plugins/:name/load     {dir}   — dynamic-imports dir/index.ts
//   DELETE /plugins/:name                  — drops it from memory
//   GET    /plugins/:name/manifest
//   POST   /plugins/:name/process
//   POST   /plugins/:name/execution-test
// Prints a single JSON line to stdout once ready: {"port": <number>}. The
// parent process reads that line to know where to send requests.

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

// Holds the callId for whichever /process request is currently running
// plugin.process() — set once per request in the handler below, read from
// inside requestApproval/reportStep so their callbacks to the parent process
// can be correlated to the right captureSteps() call there. A plain module
// variable would leak the wrong callId if two /process requests ever
// overlapped (now a real possibility across different plugins sharing this
// process, not just within one) — AsyncLocalStorage keeps them isolated the
// same way it does in the parent process's step-capture.ts.
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

// BeeContext for an external plugin: the human-interaction queue and
// step-capture buffers both live only in the parent (main) process, so
// requestApproval/reportStep proxy back there over HTTP instead of doing
// anything locally. If no callback URL was provided (e.g. this runner was
// launched standalone for testing) or no callId is available for the
// current call, they degrade to harmless no-ops rather than crashing.
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
        const data = await res.json();
        return Boolean(data.approved);
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

  // Every route is /plugins/:name/... except the load/unload pair, which
  // is /plugins/:name itself.
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
    return Response.json({ error: `Plugin '${name}' is not loaded.` }, { status: 404 });
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
        // `expect` is a function — can't cross JSON. The parent process
        // keeps its own copy of the schema-side validation; execution test
        // pass/fail for external plugins is evaluated here instead, via
        // /execution-test below.
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
        plugin.process(parsed.data)
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

// A single JSON line on stdout is the handshake: the parent process reads
// this to learn which port to talk to. Nothing else should be printed to
// stdout, or the parent's line-based read will pick up the wrong thing.
console.log(JSON.stringify({ port: server.addr.port }));
