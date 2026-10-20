import type { AttachmentDeps, AttachmentDto } from "../types.ts";
import { toAttachmentDto } from "../types.ts";

export async function getExecutionAttachments(
  deps: AttachmentDeps,
  executionId: number,
): Promise<AttachmentDto[]> {
  const rows = await deps.repo.findByExecutionId(executionId);
  return rows.map(toAttachmentDto);
}

export async function getExecutionHistoryAttachments(
  deps: AttachmentDeps,
  executionHistoryId: number,
): Promise<AttachmentDto[]> {
  const rows = await deps.repo.findByExecutionHistoryId(executionHistoryId);
  return rows.map(toAttachmentDto);
}
