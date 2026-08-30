import type { NormalizedResult } from "./normalize.ts";
import type { RoutingQuery } from "./queries.ts";
import type { MockPlugin } from "./mock-plugins.ts";
import type { z } from "zod";

export interface Verdict {
  query_id: string;
  model: string;
  category: string;
  strategy: string;
  catalog_size: number;
  run: number;
  free_text_params: boolean;
  expected_plugin: string | null;
  actual_plugin: string | null;
  selection_correct: boolean;
  params_valid: boolean | null;
  params_correct: boolean | null;
  abstained: boolean;
  hallucinated_plugin: boolean;
  format_error: boolean;
  multiple_tool_calls: boolean;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  invocations: number;
  selection_attempts_final?: number;
  parametrizer_attempts_final?: number;
}

/**
 * Evalúa el resultado normalizado contra la consulta esperada.
 *
 * @param strictDefaults
 * Si es true: los campos que el modelo agregó por su cuenta deben respetar el
 * valor por defecto declarado en el schema.
 * Si es false: esos campos se ignoran.
 * En ambos casos, los campos presentes en expected_params deben coincidir.
 */
export function evaluate(
  result: NormalizedResult,
  query: RoutingQuery,
  model:string,
  catalog: MockPlugin[],
  strategy: string,
  catalog_size: number,
  run: number,
  strictDefaults: boolean = true,
): Verdict {
  let selection_correct = false;

  if (result.format_error) {
    selection_correct = false;
  } else if (query.expected_plugin === null) {
    selection_correct = result.abstained;
  } else {
    selection_correct = result.selected_plugin === query.expected_plugin;
  }

  const hallucinated_plugin =
    result.selected_plugin !== null &&
    result.selected_plugin !== "NINGUNO_APLICA" &&
    !catalog.some((p) => p.name === result.selected_plugin);

  let params_valid: boolean | null = null;
  let params_correct: boolean | null = null;

  if (
    selection_correct &&
    !result.abstained &&
    query.expected_plugin !== null
  ) {
    const plugin = catalog.find((p) => p.name === query.expected_plugin);

    if (plugin && result.params) {
      const parseResult = plugin.schema.safeParse(result.params);
      params_valid = parseResult.success;

      if (params_valid) {
        params_correct = compareParams(
          result.params as Record<string, unknown>,
          query.expected_params,
          plugin.schema,
          strictDefaults,
        );
      }
    } else {
      params_valid = false;
    }
  }

  return {
    query_id: query.id,
    model,
    category: query.category,
    free_text_params: query.free_text_params ?? false,
    strategy,
    catalog_size,
    run,
    expected_plugin: query.expected_plugin,
    actual_plugin: result.selected_plugin,
    selection_correct,
    params_valid,
    params_correct,
    abstained: result.abstained,
    hallucinated_plugin,
    format_error: result.format_error,
    multiple_tool_calls: result.multiple_tool_calls,
    input_tokens: result.input_tokens,
    output_tokens: result.output_tokens,
    duration_ms: result.duration_ms,
    invocations: result.invocations,
    selection_attempts_final: result.selection_attempts_final,
    parametrizer_attempts_final: result.parametrizer_attempts_final,
  };
}

interface JsonSchemaShape {
  properties?: Record<string, { default?: unknown }>;
}

const defaultsCache = new WeakMap<object, Record<string, unknown>>();

function getSchemaDefaults(
  schema: z.ZodObject<z.ZodRawShape>,
): Record<string, unknown> {
  const cached = defaultsCache.get(schema);
  if (cached) return cached;

  const jsonSchema = schema.toJSONSchema() as JsonSchemaShape;
  const defaults: Record<string, unknown> = {};

  for (const [key, prop] of Object.entries(jsonSchema.properties ?? {})) {
    if (prop && "default" in prop) {
      defaults[key] = prop.default;
    }
  }

  defaultsCache.set(schema, defaults);
  return defaults;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) {
    return false;
  }
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);

  if (keysA.length !== keysB.length) return false;

  return keysA.every(
    (key) => Object.hasOwn(objB, key) && deepEqual(objA[key], objB[key]),
  );
}

function compareParams(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
  schema: z.ZodObject<z.ZodRawShape>,
  strictDefaults: boolean,
): boolean {
  for (const key of Object.keys(expected)) {
    if (!Object.hasOwn(actual, key)) return false;
    if (!deepEqual(actual[key], expected[key])) return false;
  }

  if (!strictDefaults) return true;

  const shape = schema.shape;
  const defaults = getSchemaDefaults(schema);

  for (const key of Object.keys(actual)) {
    if (key in expected) continue;
    if (!(key in shape)) return false;
    if (!(key in defaults)) return false;
    if (!deepEqual(actual[key], defaults[key])) return false;
  }

  return true;
}
