import { Hono } from "hono";
import type { HiveMicrokernel } from "../../core/microkernel/hive-microkernel.ts";
import { AppError, parseId } from "../../core/api/errors.ts";
import { ResponseBuilder } from "../../core/api/response.ts";
import { getORM } from "../../infrastructure/db/orm.ts";
import { AttachmentRepository } from "../../infrastructure/db/repositories/attachment-repository.ts";
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
  return {
    repo: new AttachmentRepository(getORM()),
    dataDir: hive.getConfig().get("dataDir"),
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
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
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
