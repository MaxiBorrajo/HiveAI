import { join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type {
  BeeContext,
  BeePlugin,
  ExecutionTestCase,
  ExecutionTestKind,
  SelectionCaseKind,
  SelectionTestCase,
} from "./bee-plugin.ts";
import { HiveConfig, type HiveSettings } from "./hive-settings.ts";
import { humanInteractionQueue } from "./human-interaction.ts";
import { reportPluginStep } from "./step-capture.ts";
import { type DynamicStructuredTool, tool } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  launchExternalPlugin,
  stopSharedHostIfIdle,
  type ExternalPluginHandle,
} from "./external-plugins/external-plugin-host.ts";
import {
  ExternalPluginRegistry,
  externalPluginNameFromSourceDir,
  type ExternalPluginMetadata,
  type ExternalPluginRecord,
} from "./external-plugins/external-plugin-registry.ts";

const REQUIRED_FIELDS = [
  "name",
  "description",
  "schema",
  "process",
  "selectionTests",
  "executionTests"
] as const;

export interface TestSuiteQualityReport {
  valid: boolean;
  total: number;
  counts: Record<string, number>;
  issues: string[];
}

const MIN_TOTAL_SELECT = 9;
const MIN_PER_KIND_SELECT: Record<SelectionCaseKind, number> = {
  positive: 3,
  negative: 3,
  ambiguous: 3,
};

const MIN_TOTAL_EXEC = 9;
const MIN_PER_KIND_EXEC: Record<ExecutionTestKind, number> = {
  happy: 3,
  edge: 3,
  error: 3,
};

export class HiveMicrokernel {
  private static instance: HiveMicrokernel;
  private plugins: Map<string, BeePlugin> = new Map();
  private activePlugins: Set<string> = new Set();
  private config = new HiveConfig({
    dataDir: "",
    configDir: "",
    model: "",
    selectorModel: "",
    currentMode: "default",
    currentStrategy: "SADER",
    ollamaKvCacheType: "",
    callbackBaseUrl: "",
  });

  public static getInstance(): HiveMicrokernel {
    if (!this.instance) {
      this.instance = new HiveMicrokernel();
    }

    return this.instance;
  }

  configure(patch: Partial<HiveSettings>): void {
    this.config.set(patch);
  }

  getConfig() {
    return this.config;
  }

  private externalPluginNames = new Set<string>();
  // Only holds an entry while the plugin's subprocess is actually running
  // (i.e. while it's active). Used by deactivate() to kill it.
  private externalPluginHandles = new Map<string, ExternalPluginHandle>();
  // Metadata for external plugins that are registered but not yet activated
  // (no subprocess running). Consulted by activate() to know which real
  // source dir to launch when the placeholder gets turned on.
  private externalPluginRecords = new Map<string, ExternalPluginRecord>();

  private get externalPluginRegistry(): ExternalPluginRegistry {
    return new ExternalPluginRegistry(
      join(this.config.get("dataDir"), "external-plugins"),
    );
  }

  // A registered-but-not-running external plugin. Its process() rejects
  // since it should never actually be invoked: getTools() only offers active
  // plugins, and activate() replaces this placeholder with the real,
  // subprocess-backed BeePlugin before the plugin can be marked active.
  private buildUnloadedExternalPlugin(record: ExternalPluginRecord): BeePlugin {
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

  private buildContext(pluginName: string): BeeContext {
    return {
      getDataDir: () => join(this.config.get("dataDir"), "plugins", pluginName),
      getModel: () => this.config.get("model"),
      requestApproval: (title, description, details) => {
        const { wait } = humanInteractionQueue.requestApproval(pluginName, {
          kind: "approval",
          title,
          description,
          details,
        });
        return wait;
      },
      reportStep: (label) => reportPluginStep(label),
    };
  }

  async register(beePlugin: BeePlugin): Promise<void> {
    const existing = this.plugins.get(beePlugin.name);

    if (existing) {
      console.warn(
        `WARNING: The bee '${beePlugin.name}' was already part of the hive. Replacing her in the swarm.`,
      );
      await existing.dispose?.();
      this.plugins.delete(beePlugin.name);
    }

    const context = this.buildContext(beePlugin.name);
    await mkdir(context.getDataDir(), { recursive: true });
    const report = this.validatePlugin(beePlugin);
    if (!report.valid) {
      throw new Error(
        `ERROR: Bee '${beePlugin.name}' failed test suite quality validation:\n${JSON.stringify(report, null, 2)}`,
      );
    }

    await beePlugin.initialize(context);

    console.log(`Welcoming bee into the hive: '${beePlugin.name}'`);
    this.plugins.set(beePlugin.name, beePlugin);
  }

  validatePlugin(beePlugin: BeePlugin<z.ZodType>) {
    const selectionResults = this.validateSelectionTests(
      beePlugin.selectionTests,
    );
    const executionResults = this.validateExecutionTests(
      beePlugin.schema,
      beePlugin.executionTests,
    );

    return {
      valid: selectionResults.valid && executionResults.valid,
      total: selectionResults.total + executionResults.total,
      counts: { ...selectionResults.counts, ...executionResults.counts },
      issues: [...selectionResults.issues, ...executionResults.issues],
    };
  }

  async validatePluginStructure(beePluginPath: string): Promise<void> {
    const entryPoint = resolve(Deno.cwd(), beePluginPath, "index.ts");
    const beePluginFile = resolve(Deno.cwd(), beePluginPath, "bee-plugin.ts");

    let pluginBeeContent: string;
    try {
      pluginBeeContent = await Deno.readTextFile(beePluginFile);
      await Deno.stat(entryPoint);
    } catch (e) {
      throw new Error(
        `Plugin at '${beePluginPath}' is missing required files (index.ts and bee-plugin.ts). Details: ${e}`,
      );
    }

    const coreBeeContent = await Deno.readTextFile(
      new URL("./bee-plugin.ts", import.meta.url),
    );
    if (pluginBeeContent.trim() !== coreBeeContent.trim()) {
      throw new Error(
        `Plugin at '${beePluginPath}' is outdated: its bee-plugin.ts does not match the microkernel's version.`,
      );
    }
  }

  validateExecutionTests<S extends z.ZodType = z.ZodType>(
    schema: S,
    tests: ExecutionTestCase<S>[] = [],
  ): TestSuiteQualityReport {
    const counts: Record<ExecutionTestKind, number> = {
      happy: 0,
      edge: 0,
      error: 0,
    };
    const issues: string[] = [];

    for (const t of tests) {
      counts[t.kind]++;
      const parsed = schema.safeParse(t.params);

      if (!parsed.success && t.kind !== "error") {
        issues.push(
          `case "${t.description}" has params that do not pass its own schema`,
        );
      }
    }

    if (tests.length < MIN_TOTAL_EXEC) {
      issues.push(
        `needs at least ${MIN_TOTAL_EXEC} cases, has ${tests.length}`,
      );
    }
    for (const kind of Object.keys(MIN_PER_KIND_EXEC) as ExecutionTestKind[]) {
      if (counts[kind] < MIN_PER_KIND_EXEC[kind]) {
        issues.push(
          `needs at least ${MIN_PER_KIND_EXEC[kind]} "${kind}" cases, has ${counts[kind]}`,
        );
      }
    }

    return { valid: issues.length === 0, total: tests.length, counts, issues };
  }

  validateSelectionTests(
    tests: SelectionTestCase[] = [],
  ): TestSuiteQualityReport {
    const counts: Record<SelectionCaseKind, number> = {
      positive: 0,
      negative: 0,
      ambiguous: 0,
    };

    for (const t of tests) counts[t.kind]++;

    const issues: string[] = [];

    if (tests.length < MIN_TOTAL_SELECT) {
      issues.push(
        `needs at least ${MIN_TOTAL_SELECT} cases, has ${tests.length}`,
      );
    }

    for (const kind of Object.keys(
      MIN_PER_KIND_SELECT,
    ) as SelectionCaseKind[]) {
      if (counts[kind] < MIN_PER_KIND_SELECT[kind]) {
        issues.push(
          `needs at least ${MIN_PER_KIND_SELECT[kind]} "${kind}" cases, has ${counts[kind]}`,
        );
      }
    }

    const queries = tests.map((t) => t.query.trim().toLowerCase());
    if (new Set(queries).size !== queries.length) {
      issues.push("duplicate queries found");
    }

    return { valid: issues.length === 0, total: tests.length, counts, issues };
  }

  async unregister(name: string): Promise<void> {
    const plugin = this.plugins.get(name);

    if (!plugin) {
      console.warn(
        `WARNING: Tried to send bee '${name}' away from the hive, but she was never found in the swarm.`,
      );
      return;
    }

    console.log(`Sending bee away from the hive: '${name}'`);
    await plugin.dispose?.();
    this.plugins.delete(name);
    this.activePlugins.delete(name);
  }

  async activate(name: string): Promise<boolean> {
    if (!this.plugins.has(name)) {
      console.warn(
        `WARNING: Tried to activate '${name}' but it is not registered. Registered bees: [${Array.from(this.plugins.keys()).join(", ")}]`,
      );
      return false;
    }

    // External plugins are registered with a lightweight placeholder (no
    // subprocess running). Launch the real thing now, on activation, so a
    // plugin the user imported but never turns on never costs a process.
    if (this.externalPluginNames.has(name) && !this.externalPluginHandles.has(name)) {
      const record = this.externalPluginRecords.get(name);
      if (!record) {
        console.warn(`WARNING: No persisted record for external bee '${name}', cannot launch it.`);
        return false;
      }
      const callbackBaseUrl = this.config.get("callbackBaseUrl");
      const handle = await launchExternalPlugin(name, record.dir, callbackBaseUrl);
      this.externalPluginHandles.set(name, handle);
      await this.register(handle.plugin);
    }

    this.activePlugins.add(name);
    console.log(
      `Bee '${name}' activated. Active bees: [${Array.from(this.activePlugins).join(", ")}]`,
    );
    return true;
  }

  private hasActiveExternalPlugins(): boolean {
    for (const name of this.activePlugins) {
      if (this.externalPluginHandles.has(name)) return true;
    }
    return false;
  }

  async deactivate(name: string): Promise<boolean> {
    const removed = this.activePlugins.delete(name);
    console.log(
      `Bee '${name}' deactivated (was active: ${removed}). Active bees: [${Array.from(this.activePlugins).join(", ")}]`,
    );

    // Unload the plugin from the shared plugin-host subprocess and swap the
    // registered plugin back for the lightweight placeholder, so an
    // inactive imported plugin holds no loaded state — the whole point of
    // lazy launch. The subprocess itself only gets killed once nothing else
    // external is still active (see stopSharedHostIfIdle below).
    const handle = this.externalPluginHandles.get(name);
    if (handle) {
      await handle.stop();
      this.externalPluginHandles.delete(name);
      const record = this.externalPluginRecords.get(name);
      if (record) {
        this.plugins.set(name, this.buildUnloadedExternalPlugin(record));
      }
      stopSharedHostIfIdle(this.hasActiveExternalPlugins());
    }

    return removed;
  }

  isActive(name: string): boolean {
    return this.activePlugins.has(name);
  }

  getRegisteredPlugins(): BeePlugin[] {
    return Array.from(this.plugins.values()).map((bp) => bp);
  }

  getPlugin(name: string) {
    const plugin = this.plugins.get(name);

    return plugin;
  }

  getTools() {
    const plugins = Array.from(this.activePlugins)
      .map((name) => this.plugins.get(name))
      .filter((plugin): plugin is BeePlugin => plugin != null);

    console.log(
      `Bees offered to the Selector: [${plugins.map((p) => p.name).join(", ")}]`,
    );

    return plugins.map((plugin) => this.transformToTool(plugin));
  }

  getTool(name: string) {
    const plugin = this.getPlugin(name);

    if (!plugin) {
      return plugin;
    }

    return this.transformToTool(plugin);
  }

  private transformToTool(
    plugin: BeePlugin,
  ): DynamicStructuredTool<
    z.ZodType,
    Record<string, unknown>,
    Record<string, unknown>,
    string,
    unknown,
    string
  > {
    return tool(
      async (
        input: unknown,
        config?: RunnableConfig,
      ) => {
        const result = await this.execute(plugin.name, input, {
          signal: config?.signal,
        });
        return result.message;
      },
      {
        name: plugin.name,
        description: plugin.description,
        schema: plugin.schema,
      },
    );
  }

  async loadAndRegister(beePluginPath: string): Promise<boolean> {
    await this.validatePluginStructure(beePluginPath);
    const entryPoint = resolve(Deno.cwd(), beePluginPath, "index.ts");
    const module = await import(pathToFileURL(entryPoint).href);

    if (typeof module.default !== "function") {
      throw new TypeError(
        "The module does not export a default class. Expected 'export default class ... implements BeePlugin'.",
      );
    }

    const pluginInstance: BeePlugin = new module.default();

    for (const field of REQUIRED_FIELDS) {
      if (!(field in pluginInstance)) {
        throw new TypeError(
          `The plugin does not fulfill the BeePlugin contract: missing '${field}'.`,
        );
      }
    }

    await this.register(pluginInstance);
    return true;
  }

  // Imports a plugin from an arbitrary folder the user picked at runtime.
  // Unlike loadAndRegister (used only for built-in plugins bundled at build
  // time, which the compiled app CAN import() directly), this never imports
  // the plugin's code into this process — see
  // core/microkernel/external-plugins/external-plugin-host.ts for why. The
  // folder is copied into our own external-plugins directory (surviving even
  // if the original is later moved/deleted) and launched as a subprocess.
  async importExternalPlugin(sourceDir: string): Promise<BeePlugin> {
    const callbackBaseUrl = this.config.get("callbackBaseUrl");

    // Peek at the plugin's declared name and metadata before persisting, so
    // the copied folder is stored under the name the plugin identifies
    // itself with (not whatever the source folder happened to be called),
    // and so its tests can be saved for future restarts without needing to
    // relaunch the subprocess just to ask for them. Uses the source folder's
    // own basename as a temporary handle since the plugin's real name isn't
    // known until after this load.
    const probeName = externalPluginNameFromSourceDir(sourceDir);
    const probe = await launchExternalPlugin(probeName, sourceDir, callbackBaseUrl);
    const metadata: ExternalPluginMetadata = {
      description: probe.plugin.description,
      selectionTests: probe.plugin.selectionTests,
      executionTests: probe.plugin.executionTests.map(
        ({ expect: _expect, ...rest }) => rest,
      ),
    };
    await probe.stop();
    // Deliberately does NOT call stopSharedHostIfIdle here: the real load
    // a few lines down needs the shared host again immediately, and killing
    // it in between (a) is wasted work — respawning it is the slow part of
    // this whole flow — and (b) is a real race if another activate/import
    // is running concurrently and still relying on the same host process.
    // hasActiveExternalPlugins() also wouldn't even see this import's own
    // handle yet, since it isn't registered until below. The host is only
    // ever torn down from activate/deactivate/removeExternalPlugin, once
    // the full picture of what's still active is settled.

    const record = await this.externalPluginRegistry.importFrom(
      sourceDir,
      probe.plugin.name,
      metadata,
    );
    this.externalPluginRecords.set(record.name, record);

    // Import turns the plugin on immediately (the user just picked it), so
    // launch it in the shared plugin host now rather than leaving it as a
    // placeholder.
    try {
      const handle = await launchExternalPlugin(record.name, record.dir, callbackBaseUrl);
      this.externalPluginNames.add(handle.plugin.name);
      this.externalPluginHandles.set(handle.plugin.name, handle);
      await this.register(handle.plugin);
      return handle.plugin;
    } catch (error) {
      // register() (test suite quality, etc.) can still fail after the copy
      // above already landed on disk and in the manifest — without this,
      // a rejected import leaves an orphaned, unregistered copy behind that
      // never shows up in the plugin list but blocks a clean re-import.
      this.externalPluginRecords.delete(record.name);
      this.externalPluginNames.delete(record.name);
      this.externalPluginHandles.delete(record.name);
      await this.externalPluginRegistry.remove(record.name);
      throw error;
    }
  }

  // Called once at startup (after configure() has set the real dataDir and
  // callbackBaseUrl) to register every previously-imported external plugin
  // using its persisted metadata, WITHOUT launching a subprocess for it —
  // subprocesses are only spawned lazily, on activate(), so an imported but
  // inactive plugin costs no RAM. Imports survive an app restart without the
  // user having to re-import them.
  async loadPersistedExternalPlugins(): Promise<void> {
    const records = await this.externalPluginRegistry.list();
    for (const record of records) {
      try {
        this.externalPluginRecords.set(record.name, record);
        this.externalPluginNames.add(record.name);
        await this.register(this.buildUnloadedExternalPlugin(record));
      } catch (error) {
        console.error(
          `ERROR: Could not register external plugin '${record.name}':`,
          error,
        );
      }
    }
  }

  isExternalPlugin(name: string): boolean {
    return this.externalPluginNames.has(name);
  }

  // Where an already-imported external plugin's code lives on disk, so it
  // can be re-exported as a .zip (e.g. to share with someone else) without
  // needing its subprocess to be running.
  async getExternalPluginDir(name: string): Promise<string | undefined> {
    if (!this.externalPluginNames.has(name)) return undefined;
    const record = this.externalPluginRecords.get(name) ??
      (await this.externalPluginRegistry.get(name));
    return record?.dir;
  }

  // Deactivates and unregisters an external plugin (killing its subprocess
  // if it was running) WITHOUT touching its files or manifest entry on
  // disk — shared by removeExternalPlugin (which deletes those right after)
  // and convertExternalPluginToDraft (which instead moves them into the
  // drafts directory for editing). Returns its on-disk dir so the caller
  // can decide what to do with it.
  private async detachExternalPlugin(name: string): Promise<string | undefined> {
    if (!this.externalPluginNames.has(name)) return undefined;
    const dir = await this.getExternalPluginDir(name);

    const handle = this.externalPluginHandles.get(name);
    if (handle) {
      await handle.stop();
      this.externalPluginHandles.delete(name);
    }
    // unregister() below also calls plugin.dispose?.() on the still-registered
    // handle.plugin, which issues a second, now-redundant DELETE to the
    // plugin host — harmless (the host just replies success on an
    // already-unloaded name) and not worth special-casing unregister() for,
    // since it's shared with built-in plugins that DO need their dispose().
    await this.unregister(name);
    this.externalPluginNames.delete(name);
    this.externalPluginRecords.delete(name);
    stopSharedHostIfIdle(this.hasActiveExternalPlugins());
    return dir;
  }

  async removeExternalPlugin(name: string): Promise<boolean> {
    if (!this.externalPluginNames.has(name)) return false;
    await this.detachExternalPlugin(name);
    return this.externalPluginRegistry.remove(name);
  }

  // Used by the "Edit" flow: detaches an already-imported plugin from the
  // hive (deactivating it and killing its subprocess if needed) and drops
  // its manifest entry, but leaves its code on disk — the caller is
  // expected to move that folder into the drafts directory right after, so
  // no plugin code is ever deleted by editing it.
  async detachExternalPluginForEdit(name: string): Promise<string | undefined> {
    const dir = await this.detachExternalPlugin(name);
    if (dir === undefined) return undefined;
    await this.externalPluginRegistry.forget(name);
    return dir;
  }

  async execute(
    name: string,
    data: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<{ success: boolean; message: string }> {
    const plugin = this.getPlugin(name);

    if (!plugin) {
      const errorMessage = `ERROR: Bee '${name}' is not part of the hive.`;
      console.error(errorMessage);
      return { success: false, message: errorMessage };
    }

    const result = plugin.schema.safeParse(data);

    if (!result.success) {
      const errorMessage = `ERROR: Bee '${name}' was given invalid nectar: ${z.prettifyError(
        result.error,
      )}`;
      console.error(errorMessage);
      return { success: false, message: errorMessage };
    }

    try {
      const response = await plugin.process(result.data, options);
      return { success: true, message: response };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`ERROR: Bee '${name}' got lost while foraging.`, error);
      return {
        success: false,
        message: `ERROR: Bee '${name}' got lost while foraging: ${detail}`,
      };
    }
  }
}
