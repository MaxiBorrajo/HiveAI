import type { SecretStore } from "../../core/secrets/secret-store.ts";
import type { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import type { PluginConfigRepository } from "../../infrastructure/db/repositories/plugin-config-repository.ts";

export interface PluginConfigDeps {
  repo: PluginConfigRepository;
  secrets: SecretStore;
  hive: HiveMicrokernel;
}

export interface PluginConfigFieldDto {
  key: string;
  label: string;
  secret: boolean;
  masked: string | null;
  value: string | null;
}
