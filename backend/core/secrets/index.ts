import { HiveMicrokernel } from "../microkernel/hive-microkernel.ts";
import { SecretStore } from "./secret-store.ts";

let store: SecretStore | undefined;
let storeDir: string | undefined;

export function getSecretStore(): SecretStore {
  const dir = HiveMicrokernel.getInstance().getConfig().get("configDir");
  if (!store || storeDir !== dir) {
    store = new SecretStore(dir);
    storeDir = dir;
  }
  return store;
}
