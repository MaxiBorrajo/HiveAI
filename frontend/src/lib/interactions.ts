export interface ApprovalPayload {
  kind: "approval";
  title: string;
  description: string;
  details?: Record<string, string>;
}

export type InteractionPayload = ApprovalPayload;

export interface PendingInteraction {
  id: string;
  pluginName: string;
  requestedAt: number;
  payload: InteractionPayload;
}

export async function listPendingInteractions(): Promise<PendingInteraction[]> {
  const response = await fetch("http://localhost:8000/interactions");
  return response.json();
}

export async function resolveInteraction(
  id: string,
  decision: "approve" | "reject",
): Promise<void> {
  await fetch(
    `http://localhost:8000/interactions/${encodeURIComponent(id)}/${decision}`,
    { method: "POST" },
  );
}
