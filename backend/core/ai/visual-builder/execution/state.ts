import { z } from "zod";
import type { ReducerStrategy, StatePropertyDefinition } from "../types.ts";

export function getReducerFunction(strategy?: ReducerStrategy) {
  switch (strategy) {
    case "append":
      return (a: unknown[], b: unknown[]) => (a || []).concat(b || []);
    case "prepend":
      return (a: unknown[], b: unknown[]) => (b || []).concat(a || []);
    case "unique_append":
      return (a: unknown[], b: unknown[]) =>
        Array.from(new Set([...(a || []), ...(b || [])]));
    case "merge_dict":
      return (a: Record<string, unknown>, b: Record<string, unknown>) => ({
        ...(a || {}),
        ...(b || {}),
      });
    case "sum":
      return (a: unknown, b: unknown) =>
        ((a as number) || 0) + ((b as number) || 0);
    case "subtract":
      return (a: unknown, b: unknown) =>
        ((a as number) || 0) - ((b as number) || 0);
    case "multiply":
      return (a: unknown, b: unknown) =>
        ((a as number) !== undefined ? (a as number) : 1) *
        ((b as number) !== undefined ? (b as number) : 1);
    case "divide":
      return (a: unknown, b: unknown) => {
        if (b === 0) throw new Error("Division by zero in reducer");
        return (
          ((a as number) !== undefined ? (a as number) : 1) /
          ((b as number) !== undefined ? (b as number) : 1)
        );
      };
    case "overwrite":
    default:
      return undefined;
  }
}

export function mapTypeToZod(def: StatePropertyDefinition): z.ZodType {
  let schema: z.ZodType;
  switch (def.type) {
    case "string":
      schema = z.string();
      break;
    case "number":
      schema = z.number();
      break;
    case "boolean":
      schema = z.boolean();
      break;
    case "enum":
      if (def.options && def.options.length > 0) {
        schema = z.enum(def.options as [string, ...string[]]);
      } else {
        schema = z.string();
      }
      break;
    case "array":
      if (def.items) {
        schema = z.array(mapTypeToZod(def.items));
      } else {
        schema = z.array(z.unknown());
      }
      break;
    case "object":
      if (def.properties) {
        const shape: Record<string, z.ZodType> = {};
        for (const [key, propDef] of Object.entries(def.properties)) {
          shape[key] = mapTypeToZod(propDef);
        }
        schema = z.object(shape);
      } else {
        schema = z.record(z.string(), z.unknown());
      }
      break;
    case "unknown":
    default:
      schema = z.unknown();
      break;
  }

  if (!def.required) {
    schema = schema.optional();
  }
  if (def.default !== undefined) {
    schema = schema.default(def.default);
  }

  return schema;
}
