import si from "systeminformation";
import type { HardwareProfile } from "../types.ts";

export interface SystemInfoLookup {
  mem: () => Promise<{ total: number; available: number }>;
  graphics: () => Promise<{
    controllers: {
      model?: string;
      vendor?: string;
      vram?: number | null;
      memoryTotal?: number | null;
    }[];
  }>;
}

export const defaultSystemInfo: SystemInfoLookup = {
  mem: () => si.mem(),
  graphics: () => si.graphics(),
};

const MIB = 1024 * 1024;
const DISCRETE_VENDORS = /nvidia|amd|advanced micro|ati\b|radeon/i;
// integrated GPUs report a few hundred MB of carve-out that Ollama does not use
const MIN_USABLE_VRAM_BYTES = 1024 * MIB;

export async function detectHardware(
  system: SystemInfoLookup = defaultSystemInfo,
  platform: string = Deno.build.os,
  arch: string = Deno.build.arch,
): Promise<HardwareProfile> {
  const mem = await system.mem();
  const base = { totalMemBytes: mem.total, availableMemBytes: mem.available };

  if (platform === "darwin" && arch === "aarch64") {
    return {
      ...base,
      gpu: { usable: true, name: "Apple Silicon", unifiedMemory: true },
    };
  }

  try {
    const { controllers } = await system.graphics();
    const best = controllers
      .map((c) => ({
        name: c.model,
        vendor: c.vendor ?? c.model ?? "",
        // systeminformation reports MiB
        vramBytes: (c.memoryTotal ?? c.vram ?? 0) * MIB,
      }))
      .filter((c) =>
        DISCRETE_VENDORS.test(c.vendor) && c.vramBytes >= MIN_USABLE_VRAM_BYTES
      )
      .sort((a, b) => b.vramBytes - a.vramBytes)[0];
    if (best) {
      return {
        ...base,
        gpu: {
          usable: true,
          name: best.name,
          vramBytes: best.vramBytes,
          unifiedMemory: false,
        },
      };
    }
  } catch {
    // no GPU information available: treat as CPU-only
  }
  return { ...base, gpu: { usable: false, unifiedMemory: false } };
}
