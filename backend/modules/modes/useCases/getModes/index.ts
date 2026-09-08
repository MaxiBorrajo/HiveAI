import modes from "../../../../config/modes.config.json" with { type: "json" };
import { ResponseBuilder } from "../../../../core/api/response.ts";

export function getModes(headers: Record<string, string>): Response {
  return ResponseBuilder.success(modes, { headers });
}
