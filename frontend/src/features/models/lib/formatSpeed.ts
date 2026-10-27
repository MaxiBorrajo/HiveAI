import { formatBytes } from "./formatBytes";

export function formatSpeed(bytesPerSec: number): string {
  return bytesPerSec > 0 ? `${formatBytes(bytesPerSec)}/s` : "—";
}
