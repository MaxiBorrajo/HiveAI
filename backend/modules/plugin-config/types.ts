import type { SecretStore } from "../../core/secrets/secret-store.ts";
import type { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import type { PluginConfigField } from "../../core/microkernel/bee-plugin.ts";
import type { PluginConfigRepository } from "../../infrastructure/db/repositories/plugin-config-repository.ts";

export interface PluginConfigDeps {
  repo: PluginConfigRepository;
  secrets: SecretStore;
  hive: HiveMicrokernel;
  /**
   * Where the declared config fields come from. Defaults to the registered
   * plugin; drafts are not registered, so they bring their own resolver.
   * Returns undefined when the plugin does not exist.
   */
  resolveFields?: (
    pluginName: string,
  ) => Promise<PluginConfigField[] | undefined>;
}

export interface PluginConfigFieldDto {
  key: string;
  label: string;
  secret: boolean;
  masked: string | null;
  value: string | null;
}
