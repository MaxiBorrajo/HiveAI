import { Hono } from "hono";
import type { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { AppError, parseId } from "../../core/api/errors.ts";
import { ResponseBuilder } from "../../core/api/response.ts";
import { getORM } from "../../infrastructure/db/orm.ts";
import { AttachmentRepository } from "../../infrastructure/db/repositories/attachment-repository.ts";
import { scheduleAttachmentIndexing } from "../../core/attachments/attachment-index.ts";
import { scheduleAttachmentRecognition } from "../../core/attachments/scan-recognition.ts";
import { toAttachmentDto } from "./types.ts";
import { attachmentText } from "../../core/attachments/build-attachment-content.ts";
import { createAttachment } from "./use-cases/create-attachment.ts";
import { getChatAttachments } from "./use-cases/get-chat-attachments.ts";
import {
  getExecutionAttachments,
  getExecutionHistoryAttachments,
} from "./use-cases/get-execution-attachments.ts";
import { deleteAttachment } from "./use-cases/delete-attachment.ts";
import { downloadAttachment } from "./use-cases/download-attachment.ts";
import type { AttachmentDeps } from "./types.ts";

export const attachmentsRouter = new Hono<{
  Variables: { hive: HiveMicrokernel };
}>();

function depsFor(hive: HiveMicrokernel): AttachmentDeps {
  const repo = new AttachmentRepository(getORM());
  const dataDir = hive.getConfig().get("dataDir");
  return {
    repo,
    dataDir,
    scheduleIndexing: (id) => scheduleAttachmentIndexing(dataDir, repo, id),
    scheduleRecognition: (id) => scheduleAttachmentRecognition(dataDir, repo, id),
  };
}

function handleAppError(error: unknown, headers: Record<string, string>) {
  if (error instanceof AppError) {
    return ResponseBuilder.error([error.message], undefined, {
      status: error.status,
      headers,
    });
  }
  throw error;
}

async function uploadHandler(
  hive: HiveMicrokernel,
  req: Request,
  headers: Record<string, string>,
  owner: { chatId?: number; executionId?: number },
): Promise<Response> {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return ResponseBuilder.error(["'file' is required."], undefined, {
        status: 400,
        headers,
      });
    }
    const direction = form.get("direction") === "output" ? "output" : "input";
    const dto = await createAttachment(depsFor(hive), file, direction, owner);
    return ResponseBuilder.success(dto, { status: 201, headers });
  } catch (error) {
    return handleAppError(error, headers);
  }
}

attachmentsRouter.post("/attachments", (c) =>
  uploadHandler(c.get("hive"), c.req.raw, { "content-type": "application/json" }, {}),
);

attachmentsRouter.post("/chats/:chatId/attachments", (c) =>
  uploadHandler(c.get("hive"), c.req.raw, { "content-type": "application/json" }, {
    chatId: parseId(c.req.param("chatId"), "chatId"),
  }),
);

attachmentsRouter.get("/chats/:chatId/attachments", async (c) => {
  const headers = { "content-type": "application/json" };
  try {
    const chatId = parseId(c.req.param("chatId"), "chatId");
    const dtos = await getChatAttachments(depsFor(c.get("hive")), chatId);
    return ResponseBuilder.success(dtos, { headers });
  } catch (error) {
    return handleAppError(error, headers);
  }
});

attachmentsRouter.post("/executions/:executionId/attachments", (c) =>
  uploadHandler(c.get("hive"), c.req.raw, { "content-type": "application/json" }, {
    executionId: parseId(c.req.param("executionId"), "executionId"),
  }),
);

attachmentsRouter.get("/executions/:executionId/attachments", async (c) => {
  const headers = { "content-type": "application/json" };
  try {
    const executionId = parseId(c.req.param("executionId"), "executionId");
    const dtos = await getExecutionAttachments(depsFor(c.get("hive")), executionId);
    return ResponseBuilder.success(dtos, { headers });
  } catch (error) {
    return handleAppError(error, headers);
  }
});

attachmentsRouter.get("/execution-history/:historyId/attachments", async (c) => {
  const headers = { "content-type": "application/json" };
  try {
    const historyId = parseId(c.req.param("historyId"), "historyId");
    const dtos = await getExecutionHistoryAttachments(depsFor(c.get("hive")), historyId);
    return ResponseBuilder.success(dtos, { headers });
  } catch (error) {
    return handleAppError(error, headers);
  }
});

// The plain filename is ASCII for old clients; filename* keeps accents and spaces.
function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

// The file as text, for previews: documents give the text extracted from them.
attachmentsRouter.get("/attachments/:id/text", async (c) => {
  const headers = { "content-type": "application/json" };
  try {
    const id = parseId(c.req.param("id"), "id");
    const deps = depsFor(c.get("hive"));
    const row = await deps.repo.findById(id);
    if (!row) throw new AppError("Attachment not found.", 404);
    const text = await attachmentText(deps.dataDir, row);
    if (text === undefined) throw new AppError("This file has no text to preview.", 415);
    return ResponseBuilder.success({ text }, { headers });
  } catch (error) {
    return handleAppError(error, headers);
  }
});

// Polled by the UI to show how far OCR got on a file.
attachmentsRouter.get("/attachments/:id", async (c) => {
  const headers = { "content-type": "application/json" };
  try {
    const id = parseId(c.req.param("id"), "id");
    const row = await depsFor(c.get("hive")).repo.findById(id);
    if (!row) throw new AppError("Attachment not found.", 404);
    return ResponseBuilder.success(toAttachmentDto(row), { headers });
  } catch (error) {
    return handleAppError(error, headers);
  }
});

attachmentsRouter.get("/attachments/:id/download", async (c) => {
  const headers = { "content-type": "application/json" };
  try {
    const id = parseId(c.req.param("id"), "id");
    const { bytes, mimeType, fileName } = await downloadAttachment(
      depsFor(c.get("hive")),
      id,
    );
    return new Response(bytes as BodyInit, {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": contentDisposition(fileName),
      },
    });
  } catch (error) {
    return handleAppError(error, headers);
  }
});

attachmentsRouter.delete("/attachments/:id", async (c) => {
  const headers = { "content-type": "application/json" };
  try {
    const id = parseId(c.req.param("id"), "id");
    await deleteAttachment(depsFor(c.get("hive")), id);
    return ResponseBuilder.success(undefined, { headers });
  } catch (error) {
    return handleAppError(error, headers);
  }
});
