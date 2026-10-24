import { AppError } from "../../../core/api/errors.ts";
import { validateApiKey } from "../../../core/ai/providers/validate-key.ts";
import type { CloudProvider } from "../../../core/ai/providers/types.ts";
import type { ApiKeyDeps } from "../types.ts";

export async function validateOrThrow(
  deps: ApiKeyDeps,
  provider: CloudProvider,
  value: string,
): Promise<void> {
  try {
    await (deps.validate ?? validateApiKey)(provider, value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const kind = (error as { kind?: string }).kind;
    throw new AppError(message, kind === "invalid_key" ? 422 : 502);
  }
}
