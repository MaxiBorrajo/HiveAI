import type { Attachment } from "../../infrastructure/db/repositories/attachment-repository.ts";
import type { AttachmentRepository } from "../../infrastructure/db/repositories/attachment-repository.ts";
import {
  scanProgress,
  type ScanState,
} from "../../core/attachments/scanned-content.ts";

export interface AttachmentDeps {
  repo: AttachmentRepository;
  dataDir: string;
  scheduleIndexing?: (attachmentId: number) => void;
  scheduleRecognition?: (attachmentId: number) => void;
}

export interface AttachmentDto {
  id: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  direction: Attachment["direction"];
  status: Attachment["status"];
  createdAt: number;
  /** Progress of OCR on the file's scanned pages and images, if it has any. */
  scan: { status: ScanState["status"]; done: number; total: number } | null;
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
    scan: row.scan ? { status: row.scan.status, ...scanProgress(row.scan) } : null,
  };
}
