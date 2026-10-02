import type { z } from "zod";
import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import type { PluginInfo } from "../../../../core/ai/visual-builder/types.ts";


export function describeActivePlugins(hive: HiveMicrokernel): PluginInfo[] {
  return hive.getTools().map((tool) => {
    const plugin = hive.getPlugin(tool.name);
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
      name: tool.name,
      description: tool.description,
      parametersDescription: parameterDescriptions.join("; "),
      parameterKeys,
      requiredKeys,
      parameterSchema: shape,
      returnDescription: (plugin as { returnDescription?: string } | undefined)
        ?.returnDescription,
    };
  });
}
