import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import type { NodeRegistry } from "../../../../core/ai/visual-builder/types.ts";

type State = Record<string, any>;

export function resolveMappingValue(
  rawMapping: unknown,
  state: State,
): unknown {
  let mapping: any = rawMapping;
  if (typeof mapping === "object" && mapping !== null) {
    mapping = mapping.value ?? mapping.staticValue ?? mapping;
  }
  if (typeof mapping !== "string") return mapping;

  if (
    mapping.startsWith("${") && mapping.endsWith("}") &&
    !mapping.slice(2, -1).includes("${")
  ) {
    const varName = mapping.slice(2, -1);
    return state[varName] !== undefined ? state[varName] : mapping;
  }
  if (state[mapping] !== undefined) return state[mapping];
  if (mapping.includes("${")) {
    return mapping.replace(
      /\$\{([^}]+)\}/g,
      (match, varName) =>
        state[varName] !== undefined ? String(state[varName]) : match,
    );
  }
  return mapping;
}

export function resolveInputMapping(
  inputMapping: Record<string, unknown>,
  state: State,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, rawMapping] of Object.entries(inputMapping)) {
    resolved[key] = resolveMappingValue(rawMapping, state);
  }
  return resolved;
}

export function createPluginNodeRegistry(hive: HiveMicrokernel): NodeRegistry {
  return {
    plugin: async (state, config) => {
      const toolName = config.pluginId as string;
      const tool = hive.getTool(toolName);
      if (!tool) throw new Error(`Tool ${toolName} not found`);

      const inputToTool = resolveInputMapping(
        (config.inputMapping as Record<string, unknown>) || {},
        state,
      );

      console.log(
        `[Plugin Executor] Running ${toolName} with input:`,
        inputToTool,
      );
      const result = await tool.invoke(inputToTool);

      const outputKey = (config.outputKey as string) || toolName;
      return { [outputKey]: result };
    },
  };
}
