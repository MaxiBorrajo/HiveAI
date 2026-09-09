import { dirname, fromFileUrl, join } from "@std/path";
import { ChatMode } from "../types.ts";

const MODULE_DIR = dirname(fromFileUrl(import.meta.url));
const CONFIG_PATH = join(MODULE_DIR, "..", "..", "..", "config", "modes.config.json");

export async function readModesConfig(): Promise<ChatMode[]> {
  const raw = await Deno.readTextFile(CONFIG_PATH);
  return JSON.parse(raw) as ChatMode[];
}

export async function writeModesConfig(modes: ChatMode[]): Promise<void> {
  await Deno.writeTextFile(CONFIG_PATH, JSON.stringify(modes, null, 2) + "\n");
}
