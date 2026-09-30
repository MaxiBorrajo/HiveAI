export interface ApprovalPayload {
  kind: "approval";
  title: string;
  description: string;
  details?: Record<string, string>;
}

export interface ClarifyPayload {
  kind: "clarify";
  question: string;
  options?: string[];
}

export type InteractionPayload = ApprovalPayload | ClarifyPayload;

export interface PendingInteraction {
  id: string;
  pluginName: string;
  requestedAt: number;
  payload: InteractionPayload;
}
