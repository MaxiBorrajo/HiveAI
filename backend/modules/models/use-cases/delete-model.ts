import { Ollama } from "ollama";
import { ResponseBuilder } from "../../../core/api/response.ts";
import { getCurrentModelRef } from "../../../core/ai/providers/current-model.ts";
import { EMBEDDING_MODEL } from "../../../core/memory/embeddings.ts";
import type { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";

export async function deleteModel(
  hive: HiveMicrokernel,
  name: string | undefined,
  headers: Record<string, string>,
): Promise<Response> {
  if (!name) {
    return ResponseBuilder.error(["'name' must be provided"], undefined, {
      headers,
      status: 400,
    });
  }

  // Conversation memory cannot work without it.
  if (name.startsWith(EMBEDDING_MODEL)) {
    return ResponseBuilder.error(
      [`'${name}' is the embedding model used for conversation memory and cannot be deleted.`],
      undefined,
      { headers, status: 409 },
    );
  }

  const active = getCurrentModelRef(hive.getConfig());
  if (active.provider === "ollama" && active.model === name) {
    return ResponseBuilder.error(
      [`'${name}' is the active model. Select another model before deleting it.`],
      undefined,
      { headers, status: 409 },
    );
  }

  try {
    await new Ollama().delete({ model: name });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return ResponseBuilder.error(
      [`Could not delete '${name}': ${detail}`],
      undefined,
      { headers, status: 502 },
    );
  }
  return ResponseBuilder.success({ name }, { headers });
}
