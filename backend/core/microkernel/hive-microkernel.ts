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
import { tool } from "@langchain/core/tools";

const REQUIRED_FIELDS = [
  "name",
  "description",
  "schema",
  "process",
  "testCases",
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
  private config = new HiveConfig({ dataDir: "", model: "" });

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

  private buildContext(pluginName: string): BeeContext {
    return {
      getDataDir: () => join(this.config.get("dataDir"), "plugins", pluginName),
      getModel: () => this.config.get("model"),
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

  validatePlugin(beePlugin: BeePlugin<z.ZodObject<any, any>>) {
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

  validateExecutionTests<S extends z.ZodObject<any, any>>(
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

      // We expect 'error' tests to potentially fail schema validation.
      // For 'happy' and 'edge', they must pass the schema.
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

  activate(name: string): boolean {
    if (!this.plugins.has(name)) {
      console.warn(
        `WARNING: Tried to activate '${name}' but it is not registered. Registered bees: [${Array.from(this.plugins.keys()).join(", ")}]`,
      );
      return false;
    }

    this.activePlugins.add(name);
    console.log(
      `Bee '${name}' activated. Active bees: [${Array.from(this.activePlugins).join(", ")}]`,
    );
    return true;
  }

  deactivate(name: string): boolean {
    const removed = this.activePlugins.delete(name);
    console.log(
      `Bee '${name}' deactivated (was active: ${removed}). Active bees: [${Array.from(this.activePlugins).join(", ")}]`,
    );
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
  ): import("@langchain/core/tools").DynamicStructuredTool<
    z.ZodObject<z.core.$ZodLooseShape, z.core.$strip>,
    Record<string, unknown>,
    Record<string, unknown>,
    string,
    unknown,
    string
  > {
    return tool(
      async (input: unknown) => {
        const result = await this.execute(plugin.name, input);
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

  async execute(
    name: string,
    data: unknown,
  ): Promise<{ success: boolean; message: string }> {
    const plugin = this.getPlugin(name);

    if (!plugin) {
      const errorMessage = `ERROR: Bee '${name}' is not part of the hive.`;
      console.error(errorMessage);
      return { success: false, message: errorMessage };
    }

    const result = plugin.schema.safeParse(data);

    if (!result.success) {
      const errorMessage = `ERROR: Bee '${name}' was given invalid nectar: ${z.prettifyError(result.error)}`;
      console.error(errorMessage);
      return { success: false, message: errorMessage };
    }

    try {
      const response = await plugin.process(result.data);
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
