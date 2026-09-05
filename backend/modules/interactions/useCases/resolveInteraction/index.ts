import { humanInteractionQueue } from "../../../../core/microkernel/human-interaction.ts";

export function handleResolveInteraction(
  id: string,
  decision: "approve" | "reject",
  headers: Record<string, string>,
): Response {
  const ok = humanInteractionQueue.resolve(id, {
    kind: "approval",
    approved: decision === "approve",
  });
  return Response.json({ success: ok }, { headers, status: ok ? 200 : 404 });
}
