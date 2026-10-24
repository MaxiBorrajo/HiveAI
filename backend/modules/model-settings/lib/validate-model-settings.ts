import { ModelSetting, ModelSettingValue } from "../types.ts";

function validateValue(
  reference: ModelSetting,
  value: ModelSettingValue,
  errors: string[],
) {
  const { name } = reference;

  if (value === null) return;

  if (typeof value !== reference.type) {
    errors.push(
      `Setting '${name}' must be of type '${reference.type}', got '${typeof value}'`,
    );
    return;
  }

  if (reference.type === "number") {
    const numValue = value as number;
    if (reference.minValue !== undefined && numValue < reference.minValue) {
      errors.push(
        `Setting '${name}' must be >= ${reference.minValue}, got ${numValue}`,
      );
    }
    if (reference.maxValue !== undefined && numValue > reference.maxValue) {
      errors.push(
        `Setting '${name}' must be <= ${reference.maxValue}, got ${numValue}`,
      );
    }
  }

  if (reference.type === "string" && reference.options?.length) {
    if (!reference.options.includes(value as string)) {
      errors.push(
        `Setting '${name}' must be one of [${reference.options.join(", ")}], got '${value}'`,
      );
    }
  }
}

export function validateModelSettings(
  incoming: Record<string, ModelSettingValue>,
  reference: ModelSetting[],
): string[] {
  const errors: string[] = [];
  const byName = new Map(reference.map((s) => [s.name, s]));

  for (const [name, value] of Object.entries(incoming)) {
    const setting = byName.get(name);
    if (!setting) {
      errors.push(`Unknown setting '${name}'`);
      continue;
    }
    validateValue(setting, value, errors);
  }

  return errors;
}
