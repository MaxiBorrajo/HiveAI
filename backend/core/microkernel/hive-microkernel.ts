import { join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type {
  BeeContext,
  BeePlugin,
  ExecutionTestCase,
  SelectionTestCase,
} from "./bee-plugin.ts";
import { HiveConfig, type HiveSettings } from "./hive-settings.ts";
import { humanInteractionQueue } from "./human-interaction.ts";
import { reportPluginStep } from "./step-capture.ts";
import { type DynamicStructuredTool, tool } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  ExternalPluginManager,
  stopSharedHostIfIdle,
} from "./external-plugins/external-plugin-manager.ts";
import {
  validatePlugin as validatePluginQuality,
  validateSelectionTests as validateSelectionTestsQuality,
  validateExecutionTests as validateExecutionTestsQuality,
  type TestSuiteQualityReport,
} from "./plugin-quality-validator.ts";

export type { TestSuiteQualityReport };

const REQUIRED_FIELDS = [
  "name",
  "description",
  "schema",
  "process",
  "selectionTests",
  "executionTests",
] as const;

export class HiveMicrokernel {
  private static instance: HiveMicrokernel;
  private plugins: Map<string, BeePlugin> = new Map();
  private activePlugins: Set<string> = new Set();
  private config = new HiveConfig({
    dataDir: "",
    configDir: "",
    model: "",
    currentMode: "default",
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

  private externalPlugins = new ExternalPluginManager(
    () => this.config.get("dataDir"),
    () => this.config.get("callbackBaseUrl"),
    (plugin) => this.register(plugin),
    (name) => this.unregister(name),
  );

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
    return validatePluginQuality(beePlugin);
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
    return validateExecutionTestsQuality(schema, tests);
  }

  validateSelectionTests(
    tests: SelectionTestCase[] = [],
  ): TestSuiteQualityReport {
    return validateSelectionTestsQuality(tests);
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

    if (
      this.externalPlugins.isExternal(name) &&
      !this.externalPlugins.hasRunningHandle(name)
    ) {
      const launched = await this.externalPlugins.launchAndRegister(name);
      if (!launched) return false;
    }

    this.activePlugins.add(name);
    console.log(
      `Bee '${name}' activated. Active bees: [${Array.from(this.activePlugins).join(", ")}]`,
    );
    return true;
  }

  async deactivate(name: string): Promise<boolean> {
    const removed = this.activePlugins.delete(name);
    console.log(
      `Bee '${name}' deactivated (was active: ${removed}). Active bees: [${Array.from(this.activePlugins).join(", ")}]`,
    );

    if (this.externalPlugins.hasRunningHandle(name)) {
      await this.externalPlugins.stopHandle(name);
      stopSharedHostIfIdle(
        this.externalPlugins.hasAnyRunningHandle(this.activePlugins),
      );
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
      async (input: unknown, config?: RunnableConfig) => {
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

  async importExternalPlugin(sourceDir: string): Promise<BeePlugin> {
    return this.externalPlugins.importFrom(sourceDir);
  }

  async loadPersistedExternalPlugins(): Promise<void> {
    await this.externalPlugins.loadPersisted();
  }

  isExternalPlugin(name: string): boolean {
    return this.externalPlugins.isExternal(name);
  }

  async getExternalPluginDir(name: string): Promise<string | undefined> {
    return this.externalPlugins.getDir(name);
  }

  async removeExternalPlugin(name: string): Promise<boolean> {
    if (!this.externalPlugins.isExternal(name)) return false;
    const removed = await this.externalPlugins.remove(name);
    stopSharedHostIfIdle(
      this.externalPlugins.hasAnyRunningHandle(this.activePlugins),
    );
    return removed;
  }

  async detachExternalPluginForEdit(name: string): Promise<string | undefined> {
    const dir = await this.externalPlugins.detachForEdit(name);
    stopSharedHostIfIdle(
      this.externalPlugins.hasAnyRunningHandle(this.activePlugins),
    );
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
