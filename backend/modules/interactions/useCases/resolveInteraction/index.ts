import { humanInteractionQueue } from "../../../../core/microkernel/human-interaction.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";

export function handleResolveInteraction(
  id: string,
  decision: "approve" | "reject",
  headers: Record<string, string>,
): Response {
  const ok = humanInteractionQueue.resolve(id, {
    kind: "approval",
    approved: decision === "approve",
  });
  if (ok) {
    return ResponseBuilder.success("Interaction resolved", { headers });
  } else {
    return ResponseBuilder.error(["Interaction not found"], undefined, {
      headers,
      status: 404,
    });
  }
}
