import type { z } from "zod";
import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import type { PluginInfo } from "../../../../core/ai/visual-builder/types.ts";


export function describeActivePlugins(hive: HiveMicrokernel): PluginInfo[] {
  return hive.getTools().map((tool) =>
    describePlugin(hive, tool.name, tool.description)
  );
}

/** Every installed plugin, active or not. */
export function describeInstalledPlugins(hive: HiveMicrokernel): PluginInfo[] {
  return hive.getRegisteredPlugins().map((plugin) =>
    describePlugin(hive, plugin.name, plugin.description)
  );
}

function describePlugin(
  hive: HiveMicrokernel,
  name: string,
  description: string,
): PluginInfo {
  {
    const plugin = hive.getPlugin(name);
    const shape = (plugin?.schema as { shape?: Record<string, z.ZodTypeAny> })
      ?.shape;

    const parameterKeys: string[] = [];
    const requiredKeys: string[] = [];
    const parameterDescriptions: string[] = [];

    for (const [key, field] of Object.entries(shape ?? {})) {
      const isOptional = field.safeParse(undefined).success;
      parameterKeys.push(key);
      if (!isOptional) requiredKeys.push(key);
      const detail = field.description ? `: ${field.description}` : "";
      parameterDescriptions.push(
        `${key} (${isOptional ? "optional" : "REQUIRED"}${detail})`,
      );
    }

    return {
      name,
      description,
      parametersDescription: parameterDescriptions.join("; "),
      parameterKeys,
      requiredKeys,
      parameterSchema: shape,
      returnDescription: (plugin as { returnDescription?: string } | undefined)
        ?.returnDescription,
    };
  }
}
