import { join } from "@std/path";
import { ChatMode } from "../types.ts";
import { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import defaultModesConfig from "../../../config/modes.config.json" with { type: "text" };

const CONFIG_FILE_NAME = "modes.config.json";

function getConfigPath(): string {
  const configDir = HiveMicrokernel.getInstance().getConfig().get("configDir");
  return join(configDir, CONFIG_FILE_NAME);
}

export async function readModesConfig(): Promise<ChatMode[]> {
  const path = getConfigPath();

  try {
    const raw = await Deno.readTextFile(path);
    return JSON.parse(raw) as ChatMode[];
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    await Deno.writeTextFile(path, defaultModesConfig);
    return JSON.parse(defaultModesConfig) as ChatMode[];
  }
}

export async function writeModesConfig(modes: ChatMode[]): Promise<void> {
  await Deno.writeTextFile(getConfigPath(), JSON.stringify(modes, null, 2) + "\n");
}
