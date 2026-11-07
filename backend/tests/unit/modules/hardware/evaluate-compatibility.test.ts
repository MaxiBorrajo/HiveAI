import { assertEquals, assertStringIncludes } from "@std/assert";
import { evaluateFit, evaluateQuants } from "../../../../modules/hardware/use-cases/evaluate-compatibility.ts";
import type { FitContext, HardwareProfile } from "../../../../modules/hardware/types.ts";

const GB = 1024 ** 3;

const GPU_PROFILE: HardwareProfile = {
  totalMemBytes: 32 * GB,
  availableMemBytes: 24 * GB,
  gpu: { usable: true, name: "RTX 4070", vramBytes: 12 * GB, unifiedMemory: false },
};
const CPU_PROFILE: HardwareProfile = {
  totalMemBytes: 8 * GB,
  availableMemBytes: 4 * GB,
  gpu: { usable: false, unifiedMemory: false },
};
const CPU_16GB: HardwareProfile = {
  totalMemBytes: 32 * GB,
  availableMemBytes: 16 * GB,
  gpu: { usable: false, unifiedMemory: false },
};
const CTX: FitContext = { nCtx: 8192, pluginTokens: 0, kvCacheType: "f16" };

const qwen8 = { sizeBytes: 5 * GB, paramsBillions: 8, contextLength: 40960 };
const qwen14 = { sizeBytes: 9 * GB, paramsBillions: 14, contextLength: 40960 };
const qwen32 = { sizeBytes: 20 * GB, paramsBillions: 32, contextLength: 40960 };
const tiny = { sizeBytes: 0.5 * GB, paramsBillions: 0.6, contextLength: 40960 };

Deno.test("GPU profile - an 8B model fits in VRAM", () => {
  const r = evaluateFit(GPU_PROFILE, qwen8, CTX);
  assertEquals(r.status, "fits");
  assertStringIncludes(r.reason, "VRAM");
});

Deno.test("GPU profile - a 14B model spills to CPU and is slow", () => {
  assertEquals(evaluateFit(GPU_PROFILE, qwen14, CTX).status, "slow");
});

Deno.test("GPU profile - a model too big for VRAM plus free RAM does not fit and says why", () => {
  const r = evaluateFit(GPU_PROFILE, { ...qwen32, sizeBytes: 40 * GB }, CTX);
  assertEquals(r.status, "no_fit");
  assertStringIncludes(r.reason, "do not fit in the");
});

Deno.test("GPU profile - only the part that overflows VRAM has to fit in free RAM", () => {
  const gpu8: HardwareProfile = {
    totalMemBytes: 16 * GB,
    availableMemBytes: 2.3 * GB,
    gpu: { usable: true, name: "RTX 3070", vramBytes: 8 * GB, unifiedMemory: false },
  };
  // ~7.8 GB needed: 7.2 GB fit in VRAM and the ~0.6 GB left over fits in the free RAM
  const r = evaluateFit(gpu8, { sizeBytes: 6.1e9, paramsBillions: 9, contextLength: 262144 }, CTX);
  assertEquals(r.status, "slow");
  assertStringIncludes(r.reason, "runs on CPU");
  // a build that overflows VRAM by more than the free RAM still does not fit
  assertEquals(evaluateFit(gpu8, { sizeBytes: 9.3e9, paramsBillions: 9, contextLength: 262144 }, CTX).status, "no_fit");
});

Deno.test("No-GPU profile - small models run on CPU, mid-size ones are slow, big ones do not fit", () => {
  assertEquals(evaluateFit(CPU_PROFILE, tiny, CTX).status, "fits");
  assertEquals(evaluateFit(CPU_16GB, qwen8, CTX).status, "slow");
  const big = evaluateFit(CPU_PROFILE, qwen14, CTX);
  assertEquals(big.status, "no_fit");
  assertStringIncludes(big.reason, "4.0 GB");
});

Deno.test("Unified memory profile uses free system memory", () => {
  const apple: HardwareProfile = {
    totalMemBytes: 16 * GB,
    availableMemBytes: 10 * GB,
    gpu: { usable: true, unifiedMemory: true },
  };
  assertEquals(evaluateFit(apple, qwen8, CTX).status, "fits");
  assertEquals(evaluateFit(apple, qwen32, CTX).status, "no_fit");
});

Deno.test("plugins eat context: usable context shrinks and can rule a model out", () => {
  const some = evaluateFit(GPU_PROFILE, qwen8, { ...CTX, pluginTokens: 3000 });
  assertEquals(some.status, "fits");
  assertEquals(some.usableContext, 8192 - 3000);
  const many = evaluateFit(GPU_PROFILE, qwen8, { ...CTX, pluginTokens: 8000 });
  assertEquals(many.status, "no_fit");
  assertStringIncludes(many.reason, "plugins");
});

Deno.test("a model trained on a short context caps the usable context", () => {
  const r = evaluateFit(GPU_PROFILE, { ...tiny, contextLength: 2048 }, { ...CTX, pluginTokens: 1500 });
  assertEquals(r.status, "no_fit");
});

Deno.test("quantized KV cache lowers the memory needed", () => {
  const f16 = evaluateFit(GPU_PROFILE, qwen8, CTX).requiredBytes;
  const q4 = evaluateFit(GPU_PROFILE, qwen8, { ...CTX, kvCacheType: "q4_0" }).requiredBytes;
  assertEquals(q4 < f16, true);
});

Deno.test("evaluateQuants - picks the preferred quant that fits, else the smallest", () => {
  const quants = [
    { name: "Q2_K", sizeBytes: 3 * GB },
    { name: "Q4_K_M", sizeBytes: 5 * GB },
    { name: "Q8_0", sizeBytes: 8.7 * GB },
  ];
  const model = { paramsBillions: 8, contextLength: 40960 };
  assertEquals(evaluateQuants(GPU_PROFILE, quants, model, CTX).best?.quant.name, "Q4_K_M");
  // 4 GB of free RAM and no GPU: only the smallest quant is viable
  const cpu = evaluateQuants(CPU_PROFILE, quants, model, CTX);
  assertEquals(cpu.best?.quant.name, "Q2_K");
  const nothing = evaluateQuants(CPU_PROFILE, [quants[2]], model, CTX);
  assertEquals(nothing.best?.fit.status, "no_fit");
  assertEquals(evaluateQuants(GPU_PROFILE, [], model, CTX).best, null);
});

Deno.test("evaluateQuants - never recommends a 1-bit quant just because it is the only one that fits", () => {
  const quants = [
    { name: "IQ1_S", sizeBytes: 1.5 * GB },
    { name: "Q4_K_M", sizeBytes: 30 * GB },
  ];
  const r = evaluateQuants(CPU_PROFILE, quants, { paramsBillions: 8, contextLength: 40960 }, CTX);
  assertEquals(r.best?.quant.name, "Q4_K_M");
  assertEquals(r.best?.fit.status, "no_fit");
});
