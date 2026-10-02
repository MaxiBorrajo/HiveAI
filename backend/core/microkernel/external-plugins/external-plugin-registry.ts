import { basename, join } from "node:path";
import { copy } from "@std/fs/copy";
import { JsonManifestStore } from "../json-manifest-store.ts";
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

export class ExternalPluginRegistry {
  private readonly store: JsonManifestStore<ExternalPluginRecord>;

  constructor(private readonly externalPluginsDir: string) {
    this.store = new JsonManifestStore(externalPluginsDir, "plugins");
  }

  list(): Promise<ExternalPluginRecord[]> {
    return this.store.read();
  }

  async get(pluginName: string): Promise<ExternalPluginRecord | undefined> {
    return (await this.store.read()).find((p) => p.name === pluginName);
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

    await this.store.upsert(record);

    return record;
  }

  async remove(pluginName: string): Promise<boolean> {
    const record = await this.store.delete(pluginName);
    if (!record) return false;

    await Deno.remove(record.dir, { recursive: true }).catch(() => {});
    return true;
  }

  async forget(pluginName: string): Promise<boolean> {
    return (await this.store.delete(pluginName)) !== undefined;
  }
}

export function externalPluginNameFromSourceDir(sourceDir: string): string {
  return basename(sourceDir);
}
