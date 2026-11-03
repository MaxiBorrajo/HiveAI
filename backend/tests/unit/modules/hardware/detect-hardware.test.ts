import { assertEquals } from "@std/assert";
import { detectHardware, type SystemInfoLookup } from "../../../../modules/hardware/lib/detect-hardware.ts";

const GB = 1024 ** 3;
const mem = () => Promise.resolve({ total: 32 * GB, available: 20 * GB });

const withGraphics = (controllers: Awaited<ReturnType<SystemInfoLookup["graphics"]>>["controllers"]): SystemInfoLookup => ({
  mem,
  graphics: () => Promise.resolve({ controllers }),
});

Deno.test("detectHardware - NVIDIA GPU is usable and reports VRAM", async () => {
  const p = await detectHardware(withGraphics([{ vendor: "NVIDIA", model: "RTX 4070", memoryTotal: 12288 }]), "linux", "x86_64");
  assertEquals(p.gpu, { usable: true, name: "RTX 4070", vramBytes: 12 * GB, unifiedMemory: false });
  assertEquals(p.totalMemBytes, 32 * GB);
  assertEquals(p.availableMemBytes, 20 * GB);
});

Deno.test("detectHardware - integrated Intel GPU is not usable", async () => {
  const p = await detectHardware(withGraphics([{ vendor: "Intel", model: "UHD 620", memoryTotal: 128 }]), "linux", "x86_64");
  assertEquals(p.gpu.usable, false);
});

Deno.test("detectHardware - Apple Silicon is unified memory", async () => {
  const p = await detectHardware(withGraphics([]), "darwin", "aarch64");
  assertEquals(p.gpu.usable, true);
  assertEquals(p.gpu.unifiedMemory, true);
});

Deno.test("detectHardware - graphics lookup failure falls back to CPU-only", async () => {
  const p = await detectHardware({ mem, graphics: () => Promise.reject(new Error("no gpu tooling")) }, "linux", "x86_64");
  assertEquals(p.gpu.usable, false);
});
