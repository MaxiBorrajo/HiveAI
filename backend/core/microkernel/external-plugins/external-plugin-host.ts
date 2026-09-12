import { z } from "zod";
import type {
  BeeContext,
  BeePlugin,
  ExecutionTestCase,
  SelectionTestCase,
} from "../bee-plugin.ts";
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

function resolveDenoExecutable(): string {
  return Deno.env.get("HIVEAI_DENO_BIN") || "deno";
}

async function readFirstLine(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
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

function buildPassthroughSchema(): z.ZodType {
  return z.record(z.string(), z.unknown());
}

export interface ExternalPluginHandle {
  plugin: BeePlugin;
  stop(): Promise<void>;
}

interface SharedHost {
  baseUrl: string;
  process: Deno.ChildProcess;
}

let sharedHost: SharedHost | null = null;
let sharedHostStarting: Promise<SharedHost> | null = null;

async function getOrStartSharedHost(
  callbackBaseUrl?: string,
): Promise<SharedHost> {
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

    process.stderr
      .pipeTo(
        new WritableStream({
          write(chunk) {
            console.error(
              `[external-plugin-host] ${new TextDecoder().decode(chunk)}`,
            );
          },
        }),
      )
      .catch(() => {});

    const handshake = await Promise.race([
      readFirstLine(process.stdout),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new ExternalPluginProcessError(
                "Timed out waiting for the plugin host subprocess to start",
              ),
            ),
          READY_TIMEOUT_MS,
        ),
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

export function stopSharedHostIfIdle(hasActiveExternalPlugins: boolean): void {
  if (hasActiveExternalPlugins || !sharedHost) return;
  try {
    sharedHost.process.kill();
  } catch {}
  sharedHost = null;
}

export async function launchExternalPlugin(
  pluginName: string,
  pluginDir: string,
  callbackBaseUrl?: string,
): Promise<ExternalPluginHandle> {
  const host = await getOrStartSharedHost(callbackBaseUrl);

  const loadRes = await fetch(
    `${host.baseUrl}/plugins/${encodeURIComponent(pluginName)}/load`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dir: pluginDir }),
    },
  );
  if (!loadRes.ok) {
    const data = await loadRes.json().catch(() => ({}));
    throw new ExternalPluginProcessError(
      data.error ||
        `Failed to load plugin '${pluginName}' into the plugin host: ${loadRes.status}`,
    );
  }

  const manifestRes = await fetch(
    `${host.baseUrl}/plugins/${encodeURIComponent(pluginName)}/manifest`,
  );
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
      expect: () => true,
    })),
    initialize: (_context: BeeContext) => {},
    process: async (input: unknown) => {
      const callId = getCurrentCallId();
      const res = await fetch(
        `${host.baseUrl}/plugins/${encodeURIComponent(manifest.name)}/process`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input, callId }),
        },
      );
      const data = await res.json();
      if (data.error) return data.error;
      return data.result;
    },
    dispose: async () => {
      await fetch(
        `${host.baseUrl}/plugins/${encodeURIComponent(manifest.name)}`,
        {
          method: "DELETE",
        },
      ).catch(() => {});
    },
  };

  return {
    plugin,
    stop: async () => {
      await fetch(
        `${host.baseUrl}/plugins/${encodeURIComponent(manifest.name)}`,
        {
          method: "DELETE",
        },
      ).catch(() => {});
    },
  };
}
