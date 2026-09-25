import { assertEquals } from "@std/assert";
import { validateModeParameters } from "./validate-mode-parameters.ts";
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

function mode(name: string, parameters: ChatModeParameter[]): ChatMode {
  return { name, description: "", isCurrent: false, parameters };
}

Deno.test("validateModeParameters - accepts a value within min/max range", () => {
  const reference = mode("full", [
    param({ name: "n_ctx", minValue: 512, maxValue: 8192 }),
  ]);
  const incoming = mode("full", [
    param({ name: "n_ctx", currentValue: 4096 }),
  ]);

  assertEquals(validateModeParameters(incoming, reference), []);
});

Deno.test("validateModeParameters - rejects unknown mode name outright", () => {
  const reference = mode("full", []);
  const incoming = mode("turbo", []);

  const errors = validateModeParameters(incoming, reference);
  assertEquals(errors, ["Unknown mode 'turbo'"]);
});

Deno.test("validateModeParameters - rejects unknown parameter name", () => {
  const reference = mode("full", [param({ name: "n_ctx" })]);
  const incoming = mode("full", [
    param({ name: "not_a_real_param", currentValue: 1 }),
  ]);

  const errors = validateModeParameters(incoming, reference);
  assertEquals(errors, [
    "Unknown parameter 'not_a_real_param' for mode 'full'",
  ]);
});

Deno.test("validateModeParameters - rejects value below minValue", () => {
  const reference = mode("full", [
    param({ name: "n_ctx", minValue: 512, maxValue: 8192 }),
  ]);
  const incoming = mode("full", [param({ name: "n_ctx", currentValue: 10 })]);

  const errors = validateModeParameters(incoming, reference);
  assertEquals(errors, ["Parameter 'n_ctx' must be >= 512, got 10"]);
});

Deno.test("validateModeParameters - rejects value above maxValue", () => {
  const reference = mode("full", [
    param({ name: "n_ctx", minValue: 512, maxValue: 8192 }),
  ]);
  const incoming = mode("full", [
    param({ name: "n_ctx", currentValue: 999999 }),
  ]);

  const errors = validateModeParameters(incoming, reference);
  assertEquals(errors, ["Parameter 'n_ctx' must be <= 8192, got 999999"]);
});

Deno.test("validateModeParameters - maxValue of null means unbounded (no error)", () => {
  const reference = mode("full", [
    param({ name: "n_gpu_layers", minValue: 0, maxValue: null }),
  ]);
  const incoming = mode("full", [
    param({ name: "n_gpu_layers", currentValue: 999999 }),
  ]);

  assertEquals(validateModeParameters(incoming, reference), []);
});

Deno.test("validateModeParameters - rejects wrong type (string given for number param)", () => {
  const reference = mode("full", [param({ name: "n_ctx", type: "number" })]);
  const incoming = mode("full", [
    param({ name: "n_ctx", type: "number", currentValue: "4096" }),
  ]);

  const errors = validateModeParameters(incoming, reference);
  assertEquals(errors, [
    "Parameter 'n_ctx' must be of type 'number', got 'string'",
  ]);
});

Deno.test("validateModeParameters - null/undefined currentValue is skipped, not an error", () => {
  const reference = mode("full", [
    param({ name: "n_ctx", minValue: 512, maxValue: 8192 }),
  ]);
  const incomingNull = mode("full", [
    param({ name: "n_ctx", currentValue: null }),
  ]);
  const incomingUndefined = mode("full", [
    param({ name: "n_ctx", currentValue: undefined }),
  ]);

  assertEquals(validateModeParameters(incomingNull, reference), []);
  assertEquals(validateModeParameters(incomingUndefined, reference), []);
});

Deno.test("validateModeParameters - accepts string value in allowed options", () => {
  const reference = mode("full", [
    param({
      name: "strategy",
      type: "string",
      defaultValue: "SCOUT",
      options: ["SCOUT", "SADER"],
    }),
  ]);
  const incoming = mode("full", [
    param({ name: "strategy", type: "string", currentValue: "SADER" }),
  ]);

  assertEquals(validateModeParameters(incoming, reference), []);
});

Deno.test("validateModeParameters - rejects string value not in allowed options", () => {
  const reference = mode("full", [
    param({
      name: "strategy",
      type: "string",
      defaultValue: "SCOUT",
      options: ["SCOUT", "SADER"],
    }),
  ]);
  const incoming = mode("full", [
    param({ name: "strategy", type: "string", currentValue: "GHOST" }),
  ]);

  const errors = validateModeParameters(incoming, reference);
  assertEquals(errors, [
    "Parameter 'strategy' must be one of [SCOUT, SADER], got 'GHOST'",
  ]);
});

Deno.test("validateModeParameters - empty options array does not restrict allowed values", () => {
  const reference = mode("full", [
    param({
      name: "strategy",
      type: "string",
      defaultValue: "SCOUT",
      options: [],
    }),
  ]);
  const incoming = mode("full", [
    param({ name: "strategy", type: "string", currentValue: "anything" }),
  ]);

  assertEquals(validateModeParameters(incoming, reference), []);
});

Deno.test("validateModeParameters - accumulates multiple errors across parameters", () => {
  const reference = mode("full", [
    param({ name: "n_ctx", minValue: 512, maxValue: 8192 }),
    param({ name: "n_threads", minValue: 1, maxValue: 32 }),
  ]);
  const incoming = mode("full", [
    param({ name: "n_ctx", currentValue: 1 }),
    param({ name: "n_threads", currentValue: 999 }),
    param({ name: "ghost_param", type: "boolean", currentValue: true }),
  ]);

  const errors = validateModeParameters(incoming, reference);
  assertEquals(errors.length, 3);
  assertEquals(errors, [
    "Parameter 'n_ctx' must be >= 512, got 1",
    "Parameter 'n_threads' must be <= 32, got 999",
    "Unknown parameter 'ghost_param' for mode 'full'",
  ]);
});

Deno.test("validateModeParameters - no parameters on either side is valid", () => {
  const reference = mode("full", []);
  const incoming = mode("full", []);

  assertEquals(validateModeParameters(incoming, reference), []);
});
