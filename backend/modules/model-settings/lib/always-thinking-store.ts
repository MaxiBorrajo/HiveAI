import { join } from "@std/path";
import { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";

/**
 * Local models seen reasoning while thinking was turned off. Ollama can only
 * ask a model not to reason; some are trained to do it anyway, and nothing
 * tells them apart beforehand, so they are recorded once they show it.
 */
const FILE_NAME = "models-that-always-think.json";

function storePath(): string {
  const configDir = HiveMicrokernel.getInstance().getConfig().get("configDir");
  return join(configDir, FILE_NAME);
}

export async function readAlwaysThinkingModels(path = storePath()): Promise<string[]> {
  try {
    const parsed = JSON.parse(await Deno.readTextFile(path));
    return Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === "string") : [];
  } catch (error) {
    if (error instanceof Deno.errors.NotFound || error instanceof SyntaxError) return [];
    throw error;
  }
}

/** Records the model; true when it was not known yet. */
export async function rememberAlwaysThinking(model: string, path = storePath()): Promise<boolean> {
  const known = await readAlwaysThinkingModels(path);
  if (known.includes(model)) return false;
  await Deno.writeTextFile(path, JSON.stringify([...known, model].sort(), null, 2) + "\n");
  return true;
}

export const ALWAYS_THINKING_NOTICE =
  "This model reasons even with thinking turned off, so it will not get faster. Its reasoning is shown apart from the answer.";
