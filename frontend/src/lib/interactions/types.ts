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
