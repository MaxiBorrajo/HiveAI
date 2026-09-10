// Tracks in-progress plugins the user is building from the in-app editor,
// before they're imported for real (see external-plugin-registry.ts for the
// "already imported" side).
//
// This is a repository interface on purpose: the JSON implementation below
// is a stopgap. Chats are going to need a real database (LanceDB, for
// embeddings/semantic search over message history), and once that's wired
// up drafts should move onto it too — at that point only
// JsonDraftPluginRepository gets replaced, callers of
// DraftPluginRepository don't change.
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

interface ManifestFile {
  drafts: DraftPluginRecord[];
}

export class JsonDraftPluginRepository implements DraftPluginRepository {
  constructor(private readonly draftsDir: string) {}

  private get manifestPath(): string {
    return `${this.draftsDir}/manifest.json`;
  }

  private async readManifest(): Promise<ManifestFile> {
    try {
      const text = await Deno.readTextFile(this.manifestPath);
      return JSON.parse(text);
    } catch {
      return { drafts: [] };
    }
  }

  private async writeManifest(manifest: ManifestFile): Promise<void> {
    await Deno.mkdir(this.draftsDir, { recursive: true });
    await Deno.writeTextFile(
      this.manifestPath,
      JSON.stringify(manifest, null, 2),
    );
  }

  async list(): Promise<DraftPluginRecord[]> {
    return (await this.readManifest()).drafts;
  }

  async get(name: string): Promise<DraftPluginRecord | undefined> {
    const manifest = await this.readManifest();
    return manifest.drafts.find((d) => d.name === name);
  }

  async save(record: DraftPluginRecord): Promise<void> {
    const manifest = await this.readManifest();
    const withoutExisting = manifest.drafts.filter((d) => d.name !== record.name);
    await this.writeManifest({ drafts: [...withoutExisting, record] });
  }

  async remove(name: string): Promise<boolean> {
    const manifest = await this.readManifest();
    const record = manifest.drafts.find((d) => d.name === name);
    if (!record) return false;

    await Deno.remove(record.dir, { recursive: true }).catch(() => {});
    await this.writeManifest({
      drafts: manifest.drafts.filter((d) => d.name !== name),
    });
    return true;
  }
}
