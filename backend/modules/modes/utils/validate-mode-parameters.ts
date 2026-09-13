import { ChatMode, ChatModeParameter } from "../types.ts";

function validateParameter(
  incoming: ChatModeParameter,
  reference: ChatModeParameter,
  errors: string[],
) {
  const path = `${reference.name}`;
  const value = incoming.currentValue;

  if (value === null || value === undefined) {
    return;
  }

  if (typeof value !== reference.type) {
    errors.push(
      `Parameter '${path}' must be of type '${reference.type}', got '${typeof value}'`,
    );
    return;
  }

  if (reference.type === "number") {
    const numValue = value as number;
    if (reference.minValue !== undefined && numValue < reference.minValue) {
      errors.push(
        `Parameter '${path}' must be >= ${reference.minValue}, got ${numValue}`,
      );
    }
    if (
      reference.maxValue !== undefined &&
      reference.maxValue !== null &&
      numValue > reference.maxValue
    ) {
      errors.push(
        `Parameter '${path}' must be <= ${reference.maxValue}, got ${numValue}`,
      );
    }
  }

  if (reference.type === "string" && reference.options) {
    const options = reference.options as string[];
    if (options.length > 0 && !options.includes(value as string)) {
      errors.push(
        `Parameter '${path}' must be one of [${options.join(", ")}], got '${value}'`,
      );
    }
  }
}

export function validateModeParameters(
  incoming: ChatMode,
  reference: ChatMode,
): string[] {
  const errors: string[] = [];

  if (incoming.name !== reference.name) {
    return [`Unknown mode '${incoming.name}'`];
  }

  const referenceParams = new Map(
    (reference.parameters ?? []).map((p) => [p.name, p]),
  );

  for (const parameter of incoming.parameters ?? []) {
    const referenceParam = referenceParams.get(parameter.name);
    if (!referenceParam) {
      errors.push(
        `Unknown parameter '${parameter.name}' for mode '${incoming.name}'`,
      );
      continue;
    }
    validateParameter(parameter, referenceParam, errors);
  }

  return errors;
}
