import { join } from "node:path";
import { z } from "zod";
import type { BeePlugin, ExecutionTestCase } from "../bee-plugin.ts";
import {
  launchExternalPlugin,
  stopSharedHostIfIdle,
  type ExternalPluginHandle,
} from "./external-plugin-host.ts";
import {
  ExternalPluginRegistry,
  externalPluginNameFromSourceDir,
  type ExternalPluginMetadata,
  type ExternalPluginRecord,
} from "./external-plugin-registry.ts";

export class ExternalPluginManager {
  private names = new Set<string>();
  private handles = new Map<string, ExternalPluginHandle>();
  private records = new Map<string, ExternalPluginRecord>();

  constructor(
    private getDataDir: () => string,
    private getCallbackBaseUrl: () => string,
    private register: (plugin: BeePlugin) => Promise<void>,
    private unregister: (name: string) => Promise<void>,
  ) {}

  private get registry(): ExternalPluginRegistry {
    return new ExternalPluginRegistry(
      join(this.getDataDir(), "external-plugins"),
    );
  }

  buildUnloadedPlugin(record: ExternalPluginRecord): BeePlugin {
    return {
      name: record.name,
      description: record.metadata.description,
      schema: z.unknown(),
      selectionTests: record.metadata.selectionTests,
      executionTests: record.metadata.executionTests.map((t) => ({
        ...t,
        expect: () => true,
      })) as ExecutionTestCase[],
      initialize: async () => {},
      process: async () => {
        throw new Error(
          `ERROR: External bee '${record.name}' has no running subprocess. It must be activated first.`,
        );
      },
    };
  }

  isExternal(name: string): boolean {
    return this.names.has(name);
  }

  hasRunningHandle(name: string): boolean {
    return this.handles.has(name);
  }

  hasAnyRunningHandle(activeNames: Iterable<string>): boolean {
    for (const name of activeNames) {
      if (this.handles.has(name)) return true;
    }
    return false;
  }

  getRecord(name: string): ExternalPluginRecord | undefined {
    return this.records.get(name);
  }

  async launchAndRegister(name: string): Promise<boolean> {
    const record = this.records.get(name);
    if (!record) {
      console.warn(
        `WARNING: No persisted record for external bee '${name}', cannot launch it.`,
      );
      return false;
    }
    const handle = await launchExternalPlugin(
      name,
      record.dir,
      this.getCallbackBaseUrl(),
    );
    this.handles.set(name, handle);
    await this.register(handle.plugin);
    return true;
  }

  async stopHandle(name: string): Promise<void> {
    const handle = this.handles.get(name);
    if (!handle) return;
    await handle.stop();
    this.handles.delete(name);

    const record = this.records.get(name);
    if (record) {
      await this.register(this.buildUnloadedPlugin(record));
    }
  }

  async importFrom(sourceDir: string): Promise<BeePlugin> {
    const callbackBaseUrl = this.getCallbackBaseUrl();

    const probeName = externalPluginNameFromSourceDir(sourceDir);
    const probe = await launchExternalPlugin(
      probeName,
      sourceDir,
      callbackBaseUrl,
    );
    const metadata: ExternalPluginMetadata = {
      description: probe.plugin.description,
      selectionTests: probe.plugin.selectionTests,
      executionTests: probe.plugin.executionTests.map(
        ({ expect: _expect, ...rest }) => rest,
      ),
    };
    await probe.stop();

    const record = await this.registry.importFrom(
      sourceDir,
      probe.plugin.name,
      metadata,
    );
    this.records.set(record.name, record);

    try {
      const handle = await launchExternalPlugin(
        record.name,
        record.dir,
        callbackBaseUrl,
      );
      this.names.add(handle.plugin.name);
      this.handles.set(handle.plugin.name, handle);
      await this.register(handle.plugin);
      return handle.plugin;
    } catch (error) {
      this.records.delete(record.name);
      this.names.delete(record.name);
      this.handles.delete(record.name);
      await this.registry.remove(record.name);
      throw error;
    }
  }

  async loadPersisted(): Promise<void> {
    const records = await this.registry.list();
    for (const record of records) {
      try {
        this.records.set(record.name, record);
        this.names.add(record.name);
        await this.register(this.buildUnloadedPlugin(record));
      } catch (error) {
        console.error(
          `ERROR: Could not register external plugin '${record.name}':`,
          error,
        );
      }
    }
  }

  async getDir(name: string): Promise<string | undefined> {
    if (!this.names.has(name)) return undefined;
    const record = this.records.get(name) ?? (await this.registry.get(name));
    return record?.dir;
  }

  async detach(name: string): Promise<string | undefined> {
    if (!this.names.has(name)) return undefined;
    const dir = await this.getDir(name);

    const handle = this.handles.get(name);
    if (handle) {
      await handle.stop();
      this.handles.delete(name);
    }

    await this.unregister(name);
    this.names.delete(name);
    this.records.delete(name);
    return dir;
  }

  async remove(name: string): Promise<boolean> {
    if (!this.names.has(name)) return false;
    await this.detach(name);
    return this.registry.remove(name);
  }

  async detachForEdit(name: string): Promise<string | undefined> {
    const dir = await this.detach(name);
    if (dir === undefined) return undefined;
    await this.registry.forget(name);
    return dir;
  }
}

export { stopSharedHostIfIdle };
