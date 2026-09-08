import { humanInteractionQueue } from "../../../../core/microkernel/human-interaction.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";

export function handleListInteractions(
  headers: Record<string, string>,
): Response {
  return ResponseBuilder.success(humanInteractionQueue.list(), { headers });
}
