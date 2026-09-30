import { assert, assertFalse } from "@std/assert";
import { matchesFilters } from "../../modules/models/useCases/getModels/index.ts";
import type { ModelInfo } from "../../modules/models/types.ts";

function makeModel(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    name: "qwen3:8b",
    architecture: "qwen3",
    family: "qwen3",
    families: ["qwen3"],
    format: "gguf",
    parentModel: "",
    sizeBytes: 5_200_000_000,
    parameterCount: 8_000_000_000,
    parameterSize: "8B",
    quantizationLevel: "Q4_K_M",
    quantizationVersion: 2,
    layerCount: 32,
    bytesPerLayer: 100,
    contextLength: 32768,
    embeddingLength: 4096,
    feedForwardLength: 11008,
    headCount: 32,
    headCountKV: 8,
    capabilities: ["completion", "tools"],
    digest: "abc123",
    modifiedAt: new Date(),
    ...overrides,
  };
}

Deno.test("matchesFilters with no filters matches any model", () => {
  assert(matchesFilters(makeModel(), {}));
});

Deno.test("matchesFilters filters by partial, case-insensitive name", () => {
  const model = makeModel({ name: "Qwen3:8b" });
  assert(matchesFilters(model, { name: "qwen3" }));
  assertFalse(matchesFilters(model, { name: "llama" }));
});

Deno.test("matchesFilters filters by exact, case-insensitive family", () => {
  const model = makeModel({ family: "Qwen3" });
  assert(matchesFilters(model, { family: "qwen3" }));
  assertFalse(matchesFilters(model, { family: "llama" }));
});

Deno.test("matchesFilters filters by size range (min and max)", () => {
  const model = makeModel({ sizeBytes: 5_000_000_000 });
  assert(matchesFilters(model, { minSizeBytes: 1_000_000_000 }));
  assertFalse(matchesFilters(model, { minSizeBytes: 10_000_000_000 }));
  assert(matchesFilters(model, { maxSizeBytes: 10_000_000_000 }));
  assertFalse(matchesFilters(model, { maxSizeBytes: 1_000_000_000 }));
});

Deno.test("matchesFilters requires every requested capability to be present", () => {
  const model = makeModel({ capabilities: ["completion", "tools"] });
  assert(matchesFilters(model, { capabilities: ["tools"] }));
  assert(
    matchesFilters(model, { capabilities: ["completion", "tools"] }),
  );
  assertFalse(matchesFilters(model, { capabilities: ["vision"] }));
});

Deno.test("matchesFilters excludeName filters out the named model", () => {
  const model = makeModel({ name: "qwen3:8b" });
  assert(matchesFilters(model, { excludeName: "other-model" }));
  assertFalse(matchesFilters(model, { excludeName: "qwen3:8b" }));
});

Deno.test("matchesFilters combines multiple filters with AND semantics", () => {
  const model = makeModel({
    family: "qwen3",
    parameterSize: "8B",
    capabilities: ["tools"],
  });

  assert(
    matchesFilters(model, {
      family: "qwen3",
      parameterSize: "8B",
      capabilities: ["tools"],
    }),
  );

  // Any single mismatching filter should reject the model.
  assertFalse(
    matchesFilters(model, {
      family: "qwen3",
      parameterSize: "70B", // mismatches
      capabilities: ["tools"],
    }),
  );
});

Deno.test("matchesFilters rejects a model above maxParameterCount", () => {
  const model = makeModel({ parameterCount: 8_000_000_000 });
  assert(matchesFilters(model, { maxParameterCount: 10_000_000_000 }));
  assertFalse(matchesFilters(model, { maxParameterCount: 1_000_000_000 }));
});

Deno.test("matchesFilters rejects a model below minContextLength", () => {
  const model = makeModel({ contextLength: 32768 });
  assert(matchesFilters(model, { minContextLength: 8192 }));
  assertFalse(matchesFilters(model, { minContextLength: 128000 }));
});
