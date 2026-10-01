import type { ConditionOperator } from "../types.ts";

export function getFieldByPath(
  source: Record<string, unknown>,
  path: string,
): unknown {
  const parts = path.split(".");
  let value: unknown = source;
  for (const part of parts) {
    value = (value as Record<string, unknown>)?.[part];
  }
  return value;
}

export function evaluateCondition(
  fieldValue: unknown,
  operator: ConditionOperator,
  targetValue: unknown,
): boolean {
  if (typeof targetValue === "boolean") {
    const fieldBool =
      typeof fieldValue === "boolean"
        ? fieldValue
        : typeof fieldValue === "string"
          ? fieldValue.trim().toLowerCase() === "true"
          : Boolean(fieldValue);
    if (operator === "equals") return fieldBool === targetValue;
    if (operator === "not_equals") return fieldBool !== targetValue;
    return false;
  }

  if (typeof targetValue === "number") {
    const fieldNum =
      typeof fieldValue === "number" ? fieldValue : Number(fieldValue);
    if (Number.isNaN(fieldNum)) return false;
    switch (operator) {
      case "equals":
        return fieldNum === targetValue;
      case "not_equals":
        return fieldNum !== targetValue;
      case "greater_than":
        return fieldNum > targetValue;
      case "greater_than_or_equals":
        return fieldNum >= targetValue;
      case "less_than":
        return fieldNum < targetValue;
      case "less_than_or_equals":
        return fieldNum <= targetValue;
    }
  }

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
      try {
        return new RegExp(targetValue as string).test(fieldValue as string);
      } catch {
        return false;
      }
    default:
      return false;
  }
}
