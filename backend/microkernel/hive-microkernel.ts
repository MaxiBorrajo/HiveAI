import { join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { BeeContext, BeePlugin } from "./bee-plugin.ts";
import { HiveConfig, type HiveSettings } from "./hive-settings.ts";
import { tool } from "@langchain/core/tools";

const REQUIRED_FIELDS = ["name", "description", "schema", "process"] as const;

export class HiveMicrokernel {
  private static instance: HiveMicrokernel;
  private plugins: Map<string, BeePlugin> = new Map();
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

  getConfig(){
    return this.config
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
    await beePlugin.initialize(context);

    console.log(`Welcoming bee into the hive: '${beePlugin.name}'`);
    this.plugins.set(beePlugin.name, beePlugin);
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
  }

  getRegisteredPlugins(): BeePlugin[] {
    return Array.from(this.plugins.values()).map((bp) => bp);
  }

  getPlugin(name: string) {
    const plugin = this.plugins.get(name);

    return plugin;
  }

  getTools() {
    return Array.from(this.plugins.values()).map((plugin) =>
      this.transformToTool(plugin),
    );
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
    try {
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
    } catch (error) {
      console.error(
        `ERROR: The intended bee to add could not fly in from ${beePluginPath} to join the hive.`,
        error,
      );
      return false;
    }
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
