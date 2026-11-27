import { ResponseBuilder } from "../../../core/api/response.ts";
import { createSseResponse } from "../../../core/api/sse.ts";
import { checkOllama } from "../../../core/ollama/ollama-status.ts";
import { getFreeDiskBytes } from "../../../core/ollama/disk-space.ts";
import { Ollama } from "ollama";
import {
  fetchRegistryInfo,
  isModelInstalled,
  parseModelName,
} from "../lib/registry-size.ts";
import { getPullManager } from "../lib/pull-manager-instance.ts";

const HEARTBEAT_MS = 3000;

export function handleListDownloads(
  headers: Record<string, string>,
): Response {
  return ResponseBuilder.success(getPullManager().list(), { headers });
}

async function listInstalledNames(): Promise<string[]> {
  try {
    return (await new Ollama().list()).models.map((m) => m.name);
  } catch {
    return [];
  }
}

export async function handleStartDownload(
  req: Request,
  headers: Record<string, string>,
): Promise<Response> {
  const body = await req.json().catch(() => ({})) as { name?: string };
  const name = body.name?.trim();
  if (!name || !parseModelName(name)) {
    return ResponseBuilder.error(
      ["Enter a valid model name, for example 'gemma3n:e4b'."],
      undefined,
      { headers, status: 400 },
    );
  }
  const ollama = await checkOllama();
  if (ollama.status !== "ok") {
    return ResponseBuilder.error([ollama.message!], { ollama: ollama.status }, {
      headers,
      status: 503,
    });
  }
  if (isModelInstalled(name, await listInstalledNames())) {
    return ResponseBuilder.error(
      [`'${name}' is already installed.`],
      { installed: true },
      { headers, status: 409 },
    );
  }
  return ResponseBuilder.success(getPullManager().enqueue(name), { headers });
}

export async function handlePreflight(
  name: string | undefined,
  headers: Record<string, string>,
): Promise<Response> {
  if (!name || !parseModelName(name)) {
    return ResponseBuilder.error(
      ["Enter a valid model name, for example 'gemma3n:e4b'."],
      undefined,
      { headers, status: 400 },
    );
  }
  const ollama = await checkOllama();
  const [registry, freeBytes, installedNames] = await Promise.all([
    fetchRegistryInfo(name),
    getFreeDiskBytes(),
    listInstalledNames(),
  ]);
  const sizeBytes = registry.sizeBytes;
  return ResponseBuilder.success({
    ollama: ollama.status,
    ollamaMessage: ollama.message,
    exists: registry.exists,
    installed: isModelInstalled(name, installedNames),
    sizeBytes,
    freeBytes,
    enoughSpace: sizeBytes !== null && freeBytes !== null
      ? freeBytes >= sizeBytes
      : null,
  }, { headers });
}

export function handleDownloadsStream(
  req: Request,
  headers: Record<string, string>,
): Response {
  return createSseResponse(headers, (send) =>
    new Promise<void>((resolve) => {
      const unsubscribe = getPullManager().subscribe((e) => send(e.type, e));
      // keeps the connection flowing so proxies/webviews do not hold back the last events
      const heartbeat = setInterval(() => {
        try {
          send("ping", {});
        } catch {
          stop();
        }
      }, HEARTBEAT_MS);
      const stop = () => {
        clearInterval(heartbeat);
        unsubscribe();
        resolve();
      };
      if (req.signal.aborted) stop();
      req.signal.addEventListener("abort", stop, { once: true });
    }));
}

export function handleDownloadAction(
  action: "cancel" | "retry",
  id: string,
  headers: Record<string, string>,
): Response {
  const manager = getPullManager();
  const result = action === "cancel" ? manager.cancel(id) : manager.retry(id);
  if (!result) {
    return ResponseBuilder.error(["Download not found"], undefined, {
      headers,
      status: 404,
    });
  }
  return ResponseBuilder.success(result, { headers });
}
