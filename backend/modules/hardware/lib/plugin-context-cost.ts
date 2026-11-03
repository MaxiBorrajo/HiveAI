import { z } from "zod";
import type { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";

const CHARS_PER_TOKEN = 4;

export interface PluginContextCost {
  tokens: number;
  plugins: { name: string; tokens: number }[];
}

export function estimateToolTokens(
  tool: { name: string; description: string; schema: unknown },
): number {
  let schema: unknown = {};
  try {
    schema = z.toJSONSchema(tool.schema as z.ZodType);
  } catch {
    // schemas that cannot be converted still cost their name and description
  }
  const json = JSON.stringify({
    name: tool.name,
    description: tool.description,
    schema,
  });
  return Math.ceil(json.length / CHARS_PER_TOKEN);
}

/** Tokens the active plugins' tool definitions add to every prompt. */
export function getPluginContextCost(hive: HiveMicrokernel): PluginContextCost {
  const plugins = hive.getTools().map((tool) => ({
    name: tool.name,
    tokens: estimateToolTokens(tool),
  }));
  return {
    tokens: plugins.reduce((sum, p) => sum + p.tokens, 0),
    plugins,
  };
}
