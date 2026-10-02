import { ResponseBuilder } from "../../../core/api/response.ts";
import { calculateRuntimeModes } from "../lib/calculate-runtime-modes.ts";
import { readModesConfig } from "../lib/modes-config.ts";

export async function getModes(
  model: string,
  currentMode: string,
  headers: Record<string, string>,
): Promise<Response> {
  const modes = await readModesConfig();
  const calculatedModes = await calculateRuntimeModes(
    modes,
    model,
    currentMode,
  );
  return ResponseBuilder.success(calculatedModes, { headers });
}
