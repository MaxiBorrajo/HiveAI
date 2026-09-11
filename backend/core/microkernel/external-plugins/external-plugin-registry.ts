// Persists which external (user-imported) plugins exist across app restarts.
//
// Importing a plugin copies its folder into our own directory instead of
// just remembering the original path — the source folder could be renamed,
// moved, or deleted (or live on a sync service like Dropbox and change
// underneath us) after import. Once copied, HiveAI owns that copy and it
// keeps working regardless of what happens to the original.
import { basename, join } from "node:path";
import { copy } from "@std/fs/copy";
import type { SelectionTestCase, ExecutionTestCase } from "../bee-plugin.ts";

// Metadata mirrors what plugin-runner.ts's /manifest endpoint returns, minus
// the non-serializable `expect` function on execution tests. Stored here so
// activate() can register a plugin's name/description/tests for the "Quick
// Plugins" list and validatePlugin() without having to launch its subprocess
// just to ask — the subprocess only needs to exist once the plugin is
// actually turned on.
export interface ExternalPluginMetadata {
  description: string;
  selectionTests: SelectionTestCase[];
  executionTests: Array<Omit<ExecutionTestCase, "expect">>;
}

export interface ExternalPluginRecord {
  name: string;
  installedAt: string;
  // Directory under externalPluginsDir where this plugin's copied code
  // lives — always `${externalPluginsDir}/${name}`, kept explicit in the
  // manifest so a future rename of that convention doesn't silently orphan
  // entries already on disk.
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

  // Copies `sourceDir` into our own external-plugins directory and records
  // it (with metadata) in the manifest. The plugin's declared `name` (read
  // by the caller from its BeePlugin instance before calling this) is used
  // as the target folder name and manifest key — re-importing the same name
  // overwrites the previous copy, which is the expected way to "update" an
  // imported plugin.
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
    const withoutExisting = manifest.plugins.filter((p) => p.name !== pluginName);
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

  // Like remove(), but leaves the plugin's folder on disk untouched — used
  // by the "Edit" flow, where the caller is about to move that same folder
  // into the drafts directory rather than delete it.
  async forget(pluginName: string): Promise<boolean> {
    const manifest = await this.readManifest();
    if (!manifest.plugins.some((p) => p.name === pluginName)) return false;

    await this.writeManifest({
      plugins: manifest.plugins.filter((p) => p.name !== pluginName),
    });
    return true;
  }
}

// Re-exported so callers don't need to know the on-disk convention.
export function externalPluginNameFromSourceDir(sourceDir: string): string {
  return basename(sourceDir);
}
