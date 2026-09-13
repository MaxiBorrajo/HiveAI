import { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";

export function setCurrentMode(hive: HiveMicrokernel, name: string): void {
  hive.configure({ currentMode: name });
}
