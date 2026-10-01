import { assertEquals } from "@std/assert";
import {
  applyRuntimeHints,
  RuntimeHints,
} from "./calculate-runtime-modes.ts";
import { ChatMode, ChatModeParameter } from "../types.ts";

function param(overrides: Partial<ChatModeParameter>): ChatModeParameter {
  return {
    name: "n_ctx",
    description: "",
    type: "number",
    defaultValue: 0,
    requiresServiceRestart: false,
    ...overrides,
  };
}

function mode(name: string, parameters: ChatModeParameter[] = []): ChatMode {
  return { name, description: "", isCurrent: false, parameters };
}

function hints(overrides: Partial<RuntimeHints> = {}): RuntimeHints {
  return {
    maxGpuLayers: 32,
    physicalCores: 8,
    mlockSafe: true,
    modelFitsComfortably: false,
    ...overrides,
  };
}

Deno.test("applyRuntimeHints - the 'default' mode is never modified, even with a performanceNote", () => {
  const m = mode("default", [param({ name: "n_gpu_layers" })]);
  const original = structuredClone(m);

  applyRuntimeHints(m, hints({ modelFitsComfortably: true }));

  assertEquals(m, original);
});

Deno.test("applyRuntimeHints - caps n_gpu_layers maxValue to what actually fits in VRAM", () => {
  const m = mode("full", [param({ name: "n_gpu_layers", maxValue: 999 })]);

  applyRuntimeHints(m, hints({ maxGpuLayers: 24 }));

  assertEquals(m.parameters![0].maxValue, 24);
});

Deno.test("applyRuntimeHints - n_threads is capped AND defaulted to physical core count", () => {
  const m = mode("full", [
    param({
      name: "n_threads",
      maxValue: 999,
      defaultValue: 4,
      currentValue: 4,
    }),
  ]);

  applyRuntimeHints(m, hints({ physicalCores: 16 }));

  const p = m.parameters![0];
  assertEquals(p.maxValue, 16);
  assertEquals(p.defaultValue, 16);
  assertEquals(p.currentValue, 16);
});

Deno.test("applyRuntimeHints - mlock defaults to safe/unsafe based on available RAM", () => {
  const safe = mode("full", [
    param({ name: "mlock", type: "boolean", defaultValue: false }),
  ]);
  applyRuntimeHints(safe, hints({ mlockSafe: true }));
  assertEquals(safe.parameters![0].defaultValue, true);
  assertEquals(safe.parameters![0].currentValue, true);

  const unsafe = mode("full", [
    param({ name: "mlock", type: "boolean", defaultValue: true }),
  ]);
  applyRuntimeHints(unsafe, hints({ mlockSafe: false }));
  assertEquals(unsafe.parameters![0].defaultValue, false);
  assertEquals(unsafe.parameters![0].currentValue, false);
});

Deno.test("applyRuntimeHints - mmap is the inverse of mlockSafe", () => {
  const m = mode("full", [
    param({ name: "mmap", type: "boolean", defaultValue: false }),
  ]);

  applyRuntimeHints(m, hints({ mlockSafe: true }));

  // mlock is safe -> prefer not to mmap
  assertEquals(m.parameters![0].defaultValue, false);
  assertEquals(m.parameters![0].currentValue, false);
});

Deno.test("applyRuntimeHints - sets a performanceNote on 'light' mode only when the model already fits comfortably", () => {
  const fits = mode("light");
  applyRuntimeHints(fits, hints({ modelFitsComfortably: true }));
  assertEquals(typeof fits.performanceNote, "string");

  const doesNotFit = mode("light");
  applyRuntimeHints(doesNotFit, hints({ modelFitsComfortably: false }));
  assertEquals(doesNotFit.performanceNote, undefined);
});

Deno.test("applyRuntimeHints - unrelated parameter names are left completely untouched", () => {
  const m = mode("full", [
    param({ name: "temperature", currentValue: 0.7, defaultValue: 0.7 }),
  ]);
  const original = structuredClone(m.parameters![0]);

  applyRuntimeHints(m, hints());

  assertEquals(m.parameters![0], original);
});

Deno.test("applyRuntimeHints - a mode with no parameters array does not throw", () => {
  const m = mode("full");

  applyRuntimeHints(m, hints());

  assertEquals(m.parameters, []);
});
