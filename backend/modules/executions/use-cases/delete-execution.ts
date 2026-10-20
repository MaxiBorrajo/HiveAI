import { ResponseBuilder } from "../../../core/api/response.ts";
import type { AppDatabase } from "../../../infrastructure/db/orm.ts";
import { ExecutionRepository } from "../../../infrastructure/db/repositories/execution-repository.ts";
import { AttachmentRepository } from "../../../infrastructure/db/repositories/attachment-repository.ts";
import { deleteAttachmentFile } from "../../../core/attachments/attachment-storage.ts";

export async function deleteExecution(
  db: AppDatabase,
  id: number,
  headers: Record<string, string>,
  dataDir: string,
): Promise<Response> {
  try {
    const repo = new ExecutionRepository(db);

    const attachmentRepo = new AttachmentRepository(db);
    const executionAttachments = await attachmentRepo.findByExecutionId(id);
    for (const attachment of executionAttachments) {
      await deleteAttachmentFile(dataDir, attachment.storagePath);
      if (attachment.extractedTextPath) {
        await deleteAttachmentFile(dataDir, attachment.extractedTextPath);
      }
    }

    await repo.delete(id);
    return ResponseBuilder.success({ success: true }, { headers });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error(
      [`Failed to delete execution: ${detail}`],
      undefined,
      { headers, status: 500 },
    );
  }
}

