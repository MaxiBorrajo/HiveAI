export interface HiveSettings {
  dataDir: string;
  model: string;
}

export class HiveConfig {
  constructor(private settings: HiveSettings) {}

  get<K extends keyof HiveSettings>(key: K): HiveSettings[K] {
    return this.settings[key];
  }

  set(patch: Partial<HiveSettings>): void {
    Object.assign(this.settings, patch);
  }
}