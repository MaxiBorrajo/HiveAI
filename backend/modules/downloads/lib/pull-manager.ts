import { mapPullError, type PullErrorKind } from "./pull-errors.ts";

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
  errorKind?: PullErrorKind;
  capabilities?: string[];
}

export interface PullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}

export interface PullClient {
  pull(req: { model: string; stream: true }): Promise<
    AsyncIterable<PullProgress> & { abort(): void }
  >;
  abort(): void;
}

export interface PullManagerDeps {
  createClient: () => PullClient;
  listInstalled: () => Promise<string[] | null>;
  deleteModel: (name: string) => Promise<void>;
  onCompleted?: (name: string) => Promise<string[] | undefined>;
  maxParallel?: number;
  now?: () => number;
}

export type DownloadEvent =
  | { type: "snapshot"; downloads: Download[] }
  | { type: "update"; download: Download };

const ACTIVE: DownloadStatus[] = ["queued", "downloading"];

interface Internal {
  pub: Download;
  client?: PullClient;
  installedBefore: boolean;
  layers: Map<string, { total: number; completed: number }>;
  lastSample?: { at: number; bytes: number };
}

export class PullManager {
  private items = new Map<string, Internal>();
  private listeners = new Set<(e: DownloadEvent) => void>();
  private readonly maxParallel: number;
  private readonly now: () => number;

  constructor(private deps: PullManagerDeps) {
    this.maxParallel = deps.maxParallel ?? 2;
    this.now = deps.now ?? Date.now;
  }

  list(): Download[] {
    return [...this.items.values()].map((i) => ({ ...i.pub }));
  }

  subscribe(listener: (e: DownloadEvent) => void): () => void {
    this.listeners.add(listener);
    listener({ type: "snapshot", downloads: this.list() });
    return () => this.listeners.delete(listener);
  }

  /** Queues a download; returns the existing one if the same name is already active. */
  enqueue(rawName: string): Download {
    const name = rawName.trim();
    if (!name) throw new Error("'name' must be provided");
    for (const i of this.items.values()) {
      if (i.pub.name === name && ACTIVE.includes(i.pub.status)) return { ...i.pub };
    }
    const item = this.create(name);
    this.pump();
    return { ...item.pub };
  }

  cancel(id: string): Download | null {
    const item = this.items.get(id);
    if (!item) return null;
    if (item.pub.status === "queued") {
      this.set(item, { status: "cancelled", bytesPerSec: 0 });
    } else if (item.pub.status === "downloading") {
      this.set(item, { status: "cancelled", bytesPerSec: 0 });
      try {
        item.client?.abort();
      } catch {
        // already finished
      }
    }
    return { ...item.pub };
  }

  retry(id: string): Download | null {
    const item = this.items.get(id);
    if (!item) return null;
    if (item.pub.status !== "failed" && item.pub.status !== "cancelled") {
      return { ...item.pub };
    }
    item.layers.clear();
    item.lastSample = undefined;
    this.set(item, {
      status: "queued",
      completed: 0,
      total: 0,
      bytesPerSec: 0,
      phase: "queued",
      error: undefined,
      errorKind: undefined,
    });
    this.pump();
    return { ...item.pub };
  }

  /** Removes finished entries from the list. */
  clearFinished(): void {
    for (const [id, i] of this.items) {
      if (!ACTIVE.includes(i.pub.status)) this.items.delete(id);
    }
    this.emit({ type: "snapshot", downloads: this.list() });
  }

  private create(name: string): Internal {
    const item: Internal = {
      pub: {
        id: crypto.randomUUID(),
        name,
        status: "queued",
        completed: 0,
        total: 0,
        bytesPerSec: 0,
        phase: "queued",
      },
      installedBefore: false,
      layers: new Map(),
    };
    this.items.set(item.pub.id, item);
    this.emit({ type: "update", download: { ...item.pub } });
    return item;
  }

  private pump(): void {
    let running = [...this.items.values()].filter((i) =>
      i.pub.status === "downloading"
    ).length;
    for (const item of this.items.values()) {
      if (running >= this.maxParallel) break;
      if (item.pub.status !== "queued") continue;
      running++;
      this.set(item, { status: "downloading", phase: "starting" });
      void this.run(item).finally(() => this.pump());
    }
  }

  private async run(item: Internal): Promise<void> {
    const name = item.pub.name;
    const before = await this.deps.listInstalled().catch(() => null);
    item.installedBefore = !!before?.includes(name);
    const client = this.deps.createClient();
    item.client = client;
    let failure: unknown;
    try {
      const stream = await client.pull({ model: name, stream: true });
      for await (const progress of stream) {
        if (item.pub.status === "cancelled") break;
        this.onProgress(item, progress);
      }
    } catch (error) {
      failure = error;
    }

    if (item.pub.status === "cancelled") {
      await this.cleanupPartial(item);
      return;
    }
    if (failure) {
      const { kind, message } = mapPullError(failure, name);
      this.set(item, { status: "failed", bytesPerSec: 0, error: message, errorKind: kind });
      return;
    }
    let capabilities: string[] | undefined;
    try {
      capabilities = await this.deps.onCompleted?.(name);
    } catch {
      capabilities = undefined;
    }
    this.set(item, {
      status: "completed",
      bytesPerSec: 0,
      phase: "success",
      capabilities,
      completed: item.pub.total || item.pub.completed,
    });
  }

  private onProgress(item: Internal, p: PullProgress): void {
    if (p.digest && p.total) {
      item.layers.set(p.digest, { total: p.total, completed: p.completed ?? 0 });
    }
    let total = 0;
    let completed = 0;
    for (const l of item.layers.values()) {
      total += l.total;
      completed += l.completed;
    }
    const now = this.now();
    let speed = item.pub.bytesPerSec;
    const last = item.lastSample;
    if (!last) {
      item.lastSample = { at: now, bytes: completed };
    } else if (now - last.at >= 1000) {
      const instant = Math.max(0, (completed - last.bytes) / ((now - last.at) / 1000));
      speed = speed > 0 ? speed * 0.6 + instant * 0.4 : instant;
      item.lastSample = { at: now, bytes: completed };
    }
    this.set(item, { phase: p.status, total, completed, bytesPerSec: Math.round(speed) });
  }

  /** Cancelling must not leave a half-installed model listed. */
  private async cleanupPartial(item: Internal): Promise<void> {
    if (item.installedBefore) return;
    try {
      const installed = await this.deps.listInstalled();
      if (installed?.includes(item.pub.name)) {
        await this.deps.deleteModel(item.pub.name);
      }
    } catch {
      // best effort: Ollama does not list models without a complete manifest
    }
  }

  private set(item: Internal, patch: Partial<Download>): void {
    item.pub = { ...item.pub, ...patch };
    this.emit({ type: "update", download: { ...item.pub } });
  }

  private emit(event: DownloadEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        this.listeners.delete(l);
      }
    }
  }
}
