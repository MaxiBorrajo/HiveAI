import { join } from "@std/path";
import { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import { ModelSetting, ModelSettingValue } from "../types.ts";
import { MODEL_SETTING_DEFINITIONS } from "./definitions.ts";

const SETTINGS_FILE_NAME = "model-settings.json";

type Overrides = Record<string, ModelSettingValue>;

function getSettingsPath(): string {
  const configDir = HiveMicrokernel.getInstance().getConfig().get("configDir");
  return join(configDir, SETTINGS_FILE_NAME);
}

export function applyOverrides(overrides: Overrides): ModelSetting[] {
  return MODEL_SETTING_DEFINITIONS.map((definition) => ({
    ...definition,
    currentValue:
      definition.name in overrides
        ? overrides[definition.name]
        : definition.defaultValue,
  }));
}

export function extractOverrides(settings: ModelSetting[]): Overrides {
  const overrides: Overrides = {};
  for (const setting of settings) {
    if (setting.currentValue !== setting.defaultValue) {
      overrides[setting.name] = setting.currentValue;
    }
  }
  return overrides;
}

async function readOverrides(): Promise<Overrides> {
  try {
    return JSON.parse(await Deno.readTextFile(getSettingsPath())) as Overrides;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return {};
    throw error;
  }
}

export async function readModelSettings(): Promise<ModelSetting[]> {
  return applyOverrides(await readOverrides());
}

export async function writeModelSettings(
  settings: ModelSetting[],
): Promise<void> {
  await Deno.writeTextFile(
    getSettingsPath(),
    JSON.stringify(extractOverrides(settings), null, 2) + "\n",
  );
}
