import type { NormalizedResult } from "./normalize.ts";
import type { RoutingQuery } from "./queries.ts";
import type { MockPlugin } from "./mock-plugins.ts";
import type { z } from "zod";

export interface Verdict {
  query_id: string;
  category: string;
  strategy: string;
  catalog_size: number;
  run: number;
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
}

/**
 * Evalúa el resultado normalizado contra la consulta esperada.
 *
 * @param strictDefaults
 * Si es true: todo campo debe coincidir exactamente con expected_params.
 * Si es false: un campo cuyo valor difiere del esperado se ignora si el pedido
 * no lo mencionaba y el valor devuelto es el default del schema.
 * Los campos que el pedido sí determina deben coincidir siempre.
 */
export function evaluate(
  result: NormalizedResult,
  query: RoutingQuery,
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
          result.params as Record<string, any>,
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
    category: query.category,
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
  };
}

function getZodDefault(zodType: any): any {
  if (!zodType) return undefined;
  if (typeof zodType._def?.defaultValue === "function") {
    return zodType._def.defaultValue();
  }
  if (zodType._def?.innerType) {
    return getZodDefault(zodType._def.innerType);
  }
  return undefined;
}

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!keysB.includes(key) || !deepEqual(a[key], b[key])) return false;
  }
  return true;
}

function compareParams(
  actual: Record<string, any>,
  expected: Record<string, any>,
  schema: z.ZodObject<any>,
  strictDefaults: boolean,
): boolean {
  if (strictDefaults) {
    const actualKeys = Object.keys(actual);
    const expectedKeys = Object.keys(expected);
    if (actualKeys.length !== expectedKeys.length) return false;
    for (const key of expectedKeys) {
      if (!deepEqual(actual[key], expected[key])) return false;
    }
    return true;
  } else {
    const shape = schema.shape;
    const actualKeys = Object.keys(actual);
    const expectedKeys = Object.keys(expected);

    for (const key of expectedKeys) {
      if (!deepEqual(actual[key], expected[key])) return false;
    }

    for (const key of actualKeys) {
      if (!expectedKeys.includes(key)) {
        const fieldSchema = shape[key];
        const defaultValue = getZodDefault(fieldSchema);
        if (!deepEqual(actual[key], defaultValue)) return false;
      }
    }
    return true;
  }
}
