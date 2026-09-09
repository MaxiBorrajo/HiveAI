import { join } from "node:path";
import { mkdir } from "node:fs/promises";

export interface HiveSettings {
  dataDir: string;
  configDir: string;
  model: string;
  selectorModel: string;
  currentMode: string;
}

// Settings persisted across sessions. dataDir/configDir are deliberately
// excluded: they're boot-time locations always provided fresh by main.ts,
// and never something to read back from disk.
const PERSISTED_KEYS = ["model", "selectorModel", "currentMode"] as const;
type PersistedSettings = Pick<HiveSettings, (typeof PERSISTED_KEYS)[number]>;

const SETTINGS_FILE_NAME = "settings.json";

export class HiveConfig {
  constructor(private settings: HiveSettings) {}

  get<K extends keyof HiveSettings>(key: K): HiveSettings[K] {
    return this.settings[key];
  }

  set(patch: Partial<HiveSettings>): void {
    Object.assign(this.settings, patch);
    this.persist();
  }

  // Sets dataDir/configDir without persisting: they're the only settings
  // that must never themselves be written to (or read from) the settings
  // file, and are known before load() has a chance to hydrate the rest from
  // disk.
  setDataDir(dataDir: string): void {
    this.settings.dataDir = dataDir;
  }

  setConfigDir(configDir: string): void {
    this.settings.configDir = configDir;
  }

  private getSettingsPath(): string {
    return join(this.settings.configDir, SETTINGS_FILE_NAME);
  }

  private persist(): void {
    if (!this.settings.configDir) return;

    const toPersist: PersistedSettings = Object.fromEntries(
      PERSISTED_KEYS.map((key) => [key, this.settings[key]]),
    ) as PersistedSettings;

    mkdir(this.settings.configDir, { recursive: true })
      .then(() =>
        Deno.writeTextFile(
          this.getSettingsPath(),
          JSON.stringify(toPersist, null, 2) + "\n",
        ),
      )
      .catch((error) => {
        console.error("Failed to persist Hive settings:", error);
      });
  }

  async load(): Promise<void> {
    if (!this.settings.configDir) return;

    try {
      const raw = await Deno.readTextFile(this.getSettingsPath());
      const persisted = JSON.parse(raw) as Partial<PersistedSettings>;
      Object.assign(this.settings, persisted);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        console.error("Failed to load Hive settings:", error);
      }
    }
  }
}
