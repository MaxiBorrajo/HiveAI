import { z } from "zod";
import { StatePropertyDefinition, ReducerStrategy, ConditionOperator } from "./types.ts";

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
      return (
        a: Record<string, unknown>,
        b: Record<string, unknown>,
      ) => ({ ...(a || {}), ...(b || {}) });
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
      // In LangGraph, if no reducer is provided, it automatically overwrites
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

export function evaluateCondition(
  fieldValue: unknown,
  operator: ConditionOperator,
  targetValue: unknown,
): boolean {
  switch (operator) {
    case "equals":
      return fieldValue === targetValue;
    case "not_equals":
      return fieldValue !== targetValue;
    case "greater_than":
      return (fieldValue as number) > (targetValue as number);
    case "greater_than_or_equals":
      return (fieldValue as number) >= (targetValue as number);
    case "less_than":
      return (fieldValue as number) < (targetValue as number);
    case "less_than_or_equals":
      return (fieldValue as number) <= (targetValue as number);
    case "contains":
      return Array.isArray(fieldValue) || typeof fieldValue === "string"
        ? fieldValue.includes(targetValue as string)
        : false;
    case "not_contains":
      return Array.isArray(fieldValue) || typeof fieldValue === "string"
        ? !fieldValue.includes(targetValue as string)
        : true;
    case "starts_with":
      return (
        typeof fieldValue === "string" &&
        fieldValue.startsWith(targetValue as string)
      );
    case "ends_with":
      return (
        typeof fieldValue === "string" &&
        fieldValue.endsWith(targetValue as string)
      );
    case "is_empty":
      return (
        fieldValue === null ||
        fieldValue === undefined ||
        fieldValue === "" ||
        (Array.isArray(fieldValue) && fieldValue.length === 0)
      );
    case "is_not_empty":
      return (
        fieldValue !== null &&
        fieldValue !== undefined &&
        fieldValue !== "" &&
        (!Array.isArray(fieldValue) || fieldValue.length > 0)
      );
    case "in":
      return Array.isArray(targetValue) && targetValue.includes(fieldValue);
    case "not_in":
      return Array.isArray(targetValue) && !targetValue.includes(fieldValue);
    case "regex_match":
      return new RegExp(targetValue as string).test(fieldValue as string);
    default:
      return false;
  }
}

