import { assertEquals } from "@std/assert";
import { mapModeToOllamaOptions } from "./resolve-model-options.ts";
import { ChatModeParameter } from "../types.ts";

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

Deno.test("mapModeToOllamaOptions - maps a full set of known parameters", () => {
  const options = mapModeToOllamaOptions([
    param({ name: "n_ctx", currentValue: 4096 }),
    param({ name: "n_gpu_layers", currentValue: 20 }),
    param({ name: "n_threads", currentValue: 8 }),
    param({ name: "n_batch", currentValue: 512 }),
    param({ name: "mmap", type: "boolean", currentValue: true }),
    param({ name: "mlock", type: "boolean", currentValue: false }),
    param({ name: "temperature", currentValue: 0.7 }),
    param({ name: "top_k", currentValue: 40 }),
    param({ name: "top_p", currentValue: 0.9 }),
    param({ name: "repeat_penalty", currentValue: 1.1 }),
  ]);

  assertEquals(options, {
    numCtx: 4096,
    numGpu: 20,
    numThread: 8,
    numBatch: 512,
    useMmap: true,
    useMlock: false,
    temperature: 0.7,
    topK: 40,
    topP: 0.9,
    repeatPenalty: 1.1,
  });
});

Deno.test("mapModeToOllamaOptions - n_gpu_layers of -1 means 'auto', omitted from output", () => {
  const options = mapModeToOllamaOptions([
    param({ name: "n_gpu_layers", currentValue: -1 }),
  ]);

  assertEquals(options.numGpu, undefined);
  assertEquals("numGpu" in options, false);
});

Deno.test("mapModeToOllamaOptions - limit_output=false sets numPredict to -1 (unlimited)", () => {
  const options = mapModeToOllamaOptions([
    param({ name: "limit_output", type: "boolean", currentValue: false }),
  ]);

  assertEquals(options.numPredict, -1);
});

Deno.test("mapModeToOllamaOptions - limit_output=true or absent leaves numPredict unset", () => {
  const withTrue = mapModeToOllamaOptions([
    param({ name: "limit_output", type: "boolean", currentValue: true }),
  ]);
  const withoutParam = mapModeToOllamaOptions([]);

  assertEquals("numPredict" in withTrue, false);
  assertEquals("numPredict" in withoutParam, false);
});

Deno.test("mapModeToOllamaOptions - unknown parameter names are ignored, not passed through", () => {
  const options = mapModeToOllamaOptions([
    param({ name: "some_future_param", currentValue: 123 }),
  ]);

  assertEquals(options, {});
});

Deno.test("mapModeToOllamaOptions - wrong-typed currentValue is dropped, not coerced", () => {
  // n_ctx expects a number; a string value should be treated as absent.
  const options = mapModeToOllamaOptions([
    param({ name: "n_ctx", currentValue: "not-a-number" as unknown as number }),
  ]);

  assertEquals("numCtx" in options, false);
});

Deno.test("mapModeToOllamaOptions - empty parameter list produces an empty options object", () => {
  assertEquals(mapModeToOllamaOptions([]), {});
});

Deno.test("mapModeToOllamaOptions - zero and false are valid values, not stripped as falsy", () => {
  const options = mapModeToOllamaOptions([
    param({ name: "n_gpu_layers", currentValue: 0 }),
    param({ name: "mmap", type: "boolean", currentValue: false }),
  ]);

  assertEquals(options.numGpu, 0);
  assertEquals(options.useMmap, false);
});
