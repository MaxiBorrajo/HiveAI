import { JsonManifestStore } from "../json-manifest-store.ts";

export interface DraftPluginRecord {
  name: string;
  dir: string;
  createdAt: string;
  updatedAt: string;
}

export interface DraftPluginRepository {
  list(): Promise<DraftPluginRecord[]>;
  get(name: string): Promise<DraftPluginRecord | undefined>;
  save(record: DraftPluginRecord): Promise<void>;
  remove(name: string): Promise<boolean>;
}

export class JsonDraftPluginRepository implements DraftPluginRepository {
  private readonly store: JsonManifestStore<DraftPluginRecord>;

  constructor(draftsDir: string) {
    this.store = new JsonManifestStore(draftsDir, "drafts");
  }

  list(): Promise<DraftPluginRecord[]> {
    return this.store.read();
  }

  async get(name: string): Promise<DraftPluginRecord | undefined> {
    return (await this.store.read()).find((d) => d.name === name);
  }

  save(record: DraftPluginRecord): Promise<void> {
    return this.store.upsert(record);
  }

  async remove(name: string): Promise<boolean> {
    const record = await this.store.delete(name);
    if (!record) return false;

    await Deno.remove(record.dir, { recursive: true }).catch(() => {});
    return true;
  }
}
