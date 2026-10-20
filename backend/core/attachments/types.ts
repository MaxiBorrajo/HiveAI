export type AttachmentDirection = "input" | "output";

export type AttachmentStatus =
  | "ready"
  | "rejected_size"
  | "rejected_type"
  | "context_overflow";

export interface AttachmentMeta {
  id: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  direction: AttachmentDirection;
  status: AttachmentStatus;
  createdAt: number;
}
