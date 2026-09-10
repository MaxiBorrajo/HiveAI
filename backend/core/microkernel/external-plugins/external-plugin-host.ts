// Bridges user-imported plugins (arbitrary code, unknown at build time) into
// the same BeePlugin shape the rest of the system already works with.
//
// Why this exists: once the backend is packaged (deno compile / deno
// desktop), it cannot dynamically import() a path it didn't know about at
// build time — see plugin-runner.ts's header comment for the full rationale.
// So an imported plugin's actual code never runs inside the compiled main
// process. Instead, all active external plugins are loaded into a single
// shared `deno run` subprocess (always interpreted, never compiled — the
// plugin-runner.ts script itself), which CAN import() them freely, and that
// subprocess exposes each plugin over HTTP on localhost, namespaced by name.
//
// This module owns that one shared subprocess as a singleton: the first
// activate() anywhere lazily spawns it, subsequent ones just ask it to load
// another plugin, and it's only killed once the last external plugin is
// deactivated. Wraps each loaded plugin as a fetch-based adapter that
// implements the ordinary BeePlugin interface, so HiveMicrokernel.register()
// and everything downstream (Executor, validatePlugin, etc.) treats it
// exactly like a built-in plugin — and can't tell it's sharing a process
// with other external plugins.
import { z } from "zod";
import type { BeeContext, BeePlugin, ExecutionTestCase, SelectionTestCase } from "../bee-plugin.ts";
import { getCurrentCallId } from "../step-capture.ts";

const RUNNER_SCRIPT_URL = new URL("./plugin-runner.ts", import.meta.url);
const READY_TIMEOUT_MS = 15_000;

interface Manifest {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  selectionTests: SelectionTestCase[];
  executionTests: Array<Omit<ExecutionTestCase, "expect">>;
}

export class ExternalPluginProcessError extends Error {}

// Finds the deno binary to launch the subprocess with. In development this
// is whatever `deno` resolves to on PATH; a packaged build should override
// this (e.g. via an env var) to point at the Deno executable embedded
// alongside the app, since a packaged app can't assume the end user has Deno
// installed system-wide.
function resolveDenoExecutable(): string {
  return Deno.env.get("HIVEAI_DENO_BIN") || "deno";
}

async function readFirstLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex !== -1) {
        return buffer.slice(0, newlineIndex);
      }
    }
    return buffer;
  } finally {
    reader.releaseLock();
  }
}

// Builds a Zod schema that only validates shape (record of unknowns) instead
// of reconstructing the external plugin's real schema from JSON Schema —
// reconstructing full Zod validation from JSON Schema is lossy (refinements,
// custom error messages, etc. don't round-trip). Real validation of the
// input still happens inside the subprocess via the plugin's own schema; this
// object exists only so BeePlugin's `schema` field has something to satisfy
// the interface and so callers can call `.safeParse` without crashing.
function buildPassthroughSchema(): z.ZodType {
  return z.record(z.string(), z.unknown());
}

export interface ExternalPluginHandle {
  plugin: BeePlugin;
  // Unloads this plugin from the shared subprocess. Does NOT necessarily
  // kill the subprocess itself — see stopSharedHostIfIdle, called
  // separately by HiveMicrokernel once it knows no other external plugin is
  // still active.
  stop(): Promise<void>;
}

interface SharedHost {
  baseUrl: string;
  process: Deno.ChildProcess;
}

let sharedHost: SharedHost | null = null;
let sharedHostStarting: Promise<SharedHost> | null = null;

async function getOrStartSharedHost(callbackBaseUrl?: string): Promise<SharedHost> {
  if (sharedHost) return sharedHost;
  if (sharedHostStarting) return sharedHostStarting;

  sharedHostStarting = (async () => {
    const command = new Deno.Command(resolveDenoExecutable(), {
      args: [
        "run",
        "--allow-read",
        "--allow-net",
        "--allow-env",
        RUNNER_SCRIPT_URL.href,
        callbackBaseUrl ?? "",
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const process = command.spawn();

    process.stderr.pipeTo(
      new WritableStream({
        write(chunk) {
          console.error(`[external-plugin-host] ${new TextDecoder().decode(chunk)}`);
        },
      }),
    ).catch(() => {});

    const handshake = await Promise.race([
      readFirstLine(process.stdout),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new ExternalPluginProcessError("Timed out waiting for the plugin host subprocess to start")),
          READY_TIMEOUT_MS,
        )
      ),
    ]);

    let port: number;
    try {
      port = JSON.parse(handshake).port;
    } catch {
      throw new ExternalPluginProcessError(
        `Plugin host subprocess did not send a valid ready handshake: ${handshake}`,
      );
    }

    const host: SharedHost = { baseUrl: `http://127.0.0.1:${port}`, process };
    sharedHost = host;
    return host;
  })();

  try {
    return await sharedHostStarting;
  } finally {
    sharedHostStarting = null;
  }
}

// Called by HiveMicrokernel after unloading a plugin, once it has confirmed
// no other external plugin is still active — kills the whole shared
// subprocess rather than leaving it running with nothing loaded.
export function stopSharedHostIfIdle(hasActiveExternalPlugins: boolean): void {
  if (hasActiveExternalPlugins || !sharedHost) return;
  try {
    sharedHost.process.kill();
  } catch {
    // Already exited.
  }
  sharedHost = null;
}

export async function launchExternalPlugin(
  pluginName: string,
  pluginDir: string,
  callbackBaseUrl?: string,
): Promise<ExternalPluginHandle> {
  const host = await getOrStartSharedHost(callbackBaseUrl);

  const loadRes = await fetch(`${host.baseUrl}/plugins/${encodeURIComponent(pluginName)}/load`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dir: pluginDir }),
  });
  if (!loadRes.ok) {
    const data = await loadRes.json().catch(() => ({}));
    throw new ExternalPluginProcessError(
      data.error || `Failed to load plugin '${pluginName}' into the plugin host: ${loadRes.status}`,
    );
  }

  const manifestRes = await fetch(`${host.baseUrl}/plugins/${encodeURIComponent(pluginName)}/manifest`);
  if (!manifestRes.ok) {
    throw new ExternalPluginProcessError(
      `Failed to fetch manifest for plugin '${pluginName}': ${manifestRes.status}`,
    );
  }
  const manifest: Manifest = await manifestRes.json();

  const plugin: BeePlugin = {
    name: manifest.name,
    description: manifest.description,
    schema: buildPassthroughSchema(),
    selectionTests: manifest.selectionTests,
    executionTests: manifest.executionTests.map((t) => ({
      ...t,
      // The real assertion runs inside the subprocess (it has the actual
      // function); this local `expect` only exists to satisfy the
      // BeePlugin/validatePlugin shape and is never actually invoked for
      // external plugins — see modules/plugins for how external execution
      // tests are routed to /execution-test instead.
      expect: () => true,
    })),
    initialize: (_context: BeeContext) => {},
    process: async (input: unknown) => {
      // Read while still inside the same synchronous/local async chain
      // Executor's captureSteps() opened — this ID is what lets the
      // subprocess's later reportStep/requestApproval HTTP callbacks (which
      // arrive as fresh, unrelated async contexts) get correlated back to
      // this specific invocation. See step-capture.ts for the full picture.
      const callId = getCurrentCallId();
      const res = await fetch(`${host.baseUrl}/plugins/${encodeURIComponent(manifest.name)}/process`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input, callId }),
      });
      const data = await res.json();
      if (data.error) return data.error;
      return data.result;
    },
    dispose: async () => {
      await fetch(`${host.baseUrl}/plugins/${encodeURIComponent(manifest.name)}`, {
        method: "DELETE",
      }).catch(() => {});
    },
  };

  return {
    plugin,
    stop: async () => {
      await fetch(`${host.baseUrl}/plugins/${encodeURIComponent(manifest.name)}`, {
        method: "DELETE",
      }).catch(() => {});
    },
  };
}
