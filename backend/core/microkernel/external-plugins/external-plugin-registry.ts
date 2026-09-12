import { basename, join } from "node:path";
import { copy } from "@std/fs/copy";
import type { SelectionTestCase, ExecutionTestCase } from "../bee-plugin.ts";

export interface ExternalPluginMetadata {
  description: string;
  selectionTests: SelectionTestCase[];
  executionTests: Array<Omit<ExecutionTestCase, "expect">>;
}

export interface ExternalPluginRecord {
  name: string;
  installedAt: string;
  dir: string;
  metadata: ExternalPluginMetadata;
}

interface ManifestFile {
  plugins: ExternalPluginRecord[];
}

export class ExternalPluginRegistry {
  constructor(private readonly externalPluginsDir: string) {}

  private get manifestPath(): string {
    return join(this.externalPluginsDir, "manifest.json");
  }

  private async readManifest(): Promise<ManifestFile> {
    try {
      const text = await Deno.readTextFile(this.manifestPath);
      return JSON.parse(text);
    } catch {
      return { plugins: [] };
    }
  }

  private async writeManifest(manifest: ManifestFile): Promise<void> {
    await Deno.mkdir(this.externalPluginsDir, { recursive: true });
    await Deno.writeTextFile(
      this.manifestPath,
      JSON.stringify(manifest, null, 2),
    );
  }

  async list(): Promise<ExternalPluginRecord[]> {
    return (await this.readManifest()).plugins;
  }

  async get(pluginName: string): Promise<ExternalPluginRecord | undefined> {
    const manifest = await this.readManifest();
    return manifest.plugins.find((p) => p.name === pluginName);
  }

  async importFrom(
    sourceDir: string,
    pluginName: string,
    metadata: ExternalPluginMetadata,
  ): Promise<ExternalPluginRecord> {
    const targetDir = join(this.externalPluginsDir, pluginName);

    await Deno.mkdir(this.externalPluginsDir, { recursive: true });
    await Deno.remove(targetDir, { recursive: true }).catch(() => {});
    await copy(sourceDir, targetDir, { overwrite: true });

    const record: ExternalPluginRecord = {
      name: pluginName,
      installedAt: new Date().toISOString(),
      dir: targetDir,
      metadata,
    };

    const manifest = await this.readManifest();
    const withoutExisting = manifest.plugins.filter(
      (p) => p.name !== pluginName,
    );
    await this.writeManifest({ plugins: [...withoutExisting, record] });

    return record;
  }

  async remove(pluginName: string): Promise<boolean> {
    const manifest = await this.readManifest();
    const record = manifest.plugins.find((p) => p.name === pluginName);
    if (!record) return false;

    await Deno.remove(record.dir, { recursive: true }).catch(() => {});
    await this.writeManifest({
      plugins: manifest.plugins.filter((p) => p.name !== pluginName),
    });
    return true;
  }

  async forget(pluginName: string): Promise<boolean> {
    const manifest = await this.readManifest();
    if (!manifest.plugins.some((p) => p.name === pluginName)) return false;

    await this.writeManifest({
      plugins: manifest.plugins.filter((p) => p.name !== pluginName),
    });
    return true;
  }
}

export function externalPluginNameFromSourceDir(sourceDir: string): string {
  return basename(sourceDir);
}
