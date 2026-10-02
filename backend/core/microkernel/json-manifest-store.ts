import { join } from "node:path";


export class JsonManifestStore<T extends { name: string }> {
  constructor(
    private readonly dir: string,
    private readonly key: string,
  ) {}

  private get path(): string {
    return join(this.dir, "manifest.json");
  }

  async read(): Promise<T[]> {
    let text: string;
    try {
      text = await Deno.readTextFile(this.path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return [];
      throw error;
    }
    const parsed = JSON.parse(text) as Record<string, T[] | undefined>;
    return parsed[this.key] ?? [];
  }

  async write(items: T[]): Promise<void> {
    await Deno.mkdir(this.dir, { recursive: true });
    const tmpPath = `${this.path}.tmp`;
    await Deno.writeTextFile(
      tmpPath,
      JSON.stringify({ [this.key]: items }, null, 2),
    );
    await Deno.rename(tmpPath, this.path);
  }

  async upsert(item: T): Promise<void> {
    const items = await this.read();
    await this.write([...items.filter((i) => i.name !== item.name), item]);
  }

  async delete(name: string): Promise<T | undefined> {
    const items = await this.read();
    const found = items.find((i) => i.name === name);
    if (!found) return undefined;
    await this.write(items.filter((i) => i.name !== name));
    return found;
  }
}
