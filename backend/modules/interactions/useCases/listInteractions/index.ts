import { humanInteractionQueue } from "../../../../core/microkernel/human-interaction.ts";

export function handleListInteractions(
  headers: Record<string, string>,
): Response {
  return Response.json(humanInteractionQueue.list(), { headers });
}
