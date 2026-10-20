import type { Attachment } from "../../infrastructure/db/repositories/attachment-repository.ts";
import type { AttachmentRepository } from "../../infrastructure/db/repositories/attachment-repository.ts";

export interface AttachmentDeps {
  repo: AttachmentRepository;
  dataDir: string;
}

export interface AttachmentDto {
  id: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  direction: Attachment["direction"];
  status: Attachment["status"];
  createdAt: number;
}

export function toAttachmentDto(row: Attachment): AttachmentDto {
  return {
    id: row.id,
    originalName: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    direction: row.direction,
    status: row.status,
    createdAt: row.createdAt,
  };
}
