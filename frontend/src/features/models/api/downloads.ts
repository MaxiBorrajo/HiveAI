import { apiClient } from "../../../lib/apiClient";
import type { ResponseEntity } from "../../../lib/config";
import { postSse } from "../../../lib/sse";

export type DownloadStatus =
  | "queued"
  | "downloading"
  | "completed"
  | "failed"
  | "cancelled";

export interface Download {
  id: string;
  name: string;
  status: DownloadStatus;
  completed: number;
  total: number;
  bytesPerSec: number;
  phase: string;
  error?: string;
  errorKind?: "not_found" | "network" | "disk_full" | "ollama_down" | "unknown";
  capabilities?: string[];
}

export interface Preflight {
  ollama: "ok" | "not_installed" | "not_running";
  ollamaMessage?: string;
  exists: boolean;
  installed: boolean;
  sizeBytes: number | null;
  freeBytes: number | null;
  enoughSpace: boolean | null;
}

export interface ModelImpact {
  name: string;
  freedBytes: number;
  inUseNow: boolean;
  isEmbeddingModel: boolean;
  usage: {
    chat: boolean;
    executions: { id: number; name: string; nodeIds: string[] }[];
  };
}

function errorMessage(error: unknown): string {
  const e = error as { response?: { data?: ResponseEntity } ; message?: string };
  return e.response?.data?.errors?.[0] ?? e.message ?? "Unexpected error";
}

export async function startDownload(name: string): Promise<Download> {
  try {
    const { data } = await apiClient.post<ResponseEntity<Download>>(
      "/api/downloads/models",
      { name },
    );
    return data.data!;
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}

export async function listDownloads(): Promise<Download[]> {
  const { data } = await apiClient.get<ResponseEntity<Download[]>>(
    "/api/downloads/models",
  );
  return data.data ?? [];
}

export async function cancelDownload(id: string): Promise<void> {
  await apiClient.post(`/api/downloads/models/${id}/cancel`);
}

export async function retryDownload(id: string): Promise<void> {
  await apiClient.post(`/api/downloads/models/${id}/retry`);
}

export async function getPreflight(name: string): Promise<Preflight> {
  try {
    const { data } = await apiClient.get<ResponseEntity<Preflight>>(
      "/api/downloads/models/preflight",
      { params: { name } },
    );
    return data.data!;
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}

export async function getModelImpact(name: string): Promise<ModelImpact> {
  const { data } = await apiClient.get<ResponseEntity<ModelImpact>>(
    `/api/models/${encodeURIComponent(name)}/impact`,
  );
  return data.data!;
}

export function subscribeDownloads(
  onSnapshot: (downloads: Download[]) => void,
  onUpdate: (download: Download) => void,
  signal: AbortSignal,
): Promise<void> {
  return postSse(
    "/api/downloads/models/stream",
    undefined,
    (_event, payload) => {
      if (payload.type === "snapshot") onSnapshot(payload.downloads);
      else if (payload.type === "update") onUpdate(payload.download);
    },
    signal,
  );
}
