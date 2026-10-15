import { assertEquals } from "@std/assert";
import { mapSettingsToOllamaOptions } from "../../../../../modules/model-settings/lib/resolve-model-options.ts";
import { validateModelSettings } from "../../../../../modules/model-settings/lib/validate-model-settings.ts";
import {
  applyOverrides,
  extractOverrides,
} from "../../../../../modules/model-settings/lib/settings-store.ts";

Deno.test("applyOverrides - with no overrides every setting holds its default", () => {
  const settings = applyOverrides({});
  for (const setting of settings) {
    assertEquals(setting.currentValue, setting.defaultValue);
  }
  const value = (name: string) =>
    settings.find((s) => s.name === name)?.currentValue;
  assertEquals(value("kv_cache_type"), "f16");
  assertEquals(value("flash_attention"), true);
  assertEquals(value("n_ctx"), 4096);
  assertEquals(value("n_batch"), 512);
  assertEquals(value("mmap"), true);
  assertEquals(value("mlock"), false);
  assertEquals(value("keep_alive"), "30m");
  assertEquals(value("thinking"), true);
});

Deno.test("extractOverrides - persists only values that differ from the default", () => {
  const settings = applyOverrides({ n_ctx: 8192, thinking: false });
  settings.find((s) => s.name === "top_k")!.currentValue = 40;

  assertEquals(extractOverrides(settings), { n_ctx: 8192, thinking: false });
});

Deno.test("mapSettingsToOllamaOptions - maps defaults, including think", () => {
  const options = mapSettingsToOllamaOptions(applyOverrides({}));

  assertEquals(options, {
    numCtx: 4096,
    numBatch: 512,
    useMmap: true,
    useMlock: false,
    temperature: 0.7,
    topK: 40,
    topP: 0.9,
    repeatPenalty: 1.1,
    keepAlive: "30m",
    think: true,
  });
});

Deno.test("mapSettingsToOllamaOptions - thinking off, unlimited output and explicit gpu layers", () => {
  const options = mapSettingsToOllamaOptions(
    applyOverrides({ thinking: false, limit_output: false, n_gpu_layers: 20 }),
  );

  assertEquals(options.think, false);
  assertEquals(options.numPredict, -1);
  assertEquals(options.numGpu, 20);
});

Deno.test("validateModelSettings - accepts values inside the allowed range", () => {
  assertEquals(
    validateModelSettings({ n_ctx: 8192, kv_cache_type: "q8_0" }, applyOverrides({})),
    [],
  );
});

Deno.test("validateModelSettings - rejects unknown, mistyped, out-of-range and non-option values", () => {
  const errors = validateModelSettings(
    { nope: 1, n_ctx: 10, thinking: "yes", kv_cache_type: "q2" },
    applyOverrides({}),
  );

  assertEquals(errors, [
    "Unknown setting 'nope'",
    "Setting 'n_ctx' must be >= 512, got 10",
    "Setting 'thinking' must be of type 'boolean', got 'string'",
    "Setting 'kv_cache_type' must be one of [f16, q8_0, q4_0], got 'q2'",
  ]);
});
