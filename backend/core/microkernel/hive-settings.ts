export interface HiveSettings {
  dataDir: string;
  model: string;
  // Base URL external plugin subprocesses call back to for
  // requestApproval/reportStep (see core/microkernel/external-plugins/ and
  // modules/externalPluginCallbacks). Empty until main.ts knows its own
  // listening port.
  callbackBaseUrl: string;
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