import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createSseResponse } from "../../../core/api/sse.ts";
import { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import { runDraftChat } from "../../../core/ai/draft-chat/draft-chat.ts";
import type { DraftChatEvent } from "../../../core/ai/draft-chat/draft-chat.ts";
import { getDraftRepository } from "../lib/draft-context.ts";

const LOG = "[Draft Chat]";
const MAX_PROMPT_LOG_LENGTH = 100;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function logStreamEvent(event: DraftChatEvent): void {
  switch (event.type) {
    case "validation_error":
      console.log(`${LOG} [validation_error] attempt ${event.attempt}: ${event.issues?.join("; ")}`);
      break;
    case "error":
      console.log(`${LOG} [error] ${event.message}`);
      break;
  }
}

async function readCurrentIndexTs(dir: string): Promise<string | undefined> {
  try {
    const content = await readFile(join(dir, "index.ts"), "utf-8");
    // Scaffold placeholder — treat as "no real plugin yet" so the model
    // isn't asked to "edit" boilerplate TODOs.
    return content.includes("TODO: implement the plugin's actual behavior")
      ? undefined
      : content;
  } catch {
    return undefined;
  }
}

export async function handleChatEditDraft(
  hive: HiveMicrokernel,
  name: string,
  model: string,
  content: string | undefined,
  headers: Record<string, string>,
): Promise<Response> {
  return createSseResponse(headers, async (send) => {
    if (!content) {
      send("error", { message: "Missing 'content' in request body." });
      return;
    }

    const record = await getDraftRepository(hive).get(name);
    if (!record) {
      send("error", { message: "Draft not found." });
      return;
    }

    console.log(
      `${LOG} Model: "${model}" | Draft: "${name}" | Prompt: "${truncate(content, MAX_PROMPT_LOG_LENGTH)}"`,
    );

    const existingPluginNames = hive
      .getRegisteredPlugins()
      .map((p) => p.name)
      .filter((pluginName) => pluginName !== name);

    const currentSourceCode = await readCurrentIndexTs(record.dir);

    const generator = runDraftChat(
      content,
      model,
      currentSourceCode,
      existingPluginNames,
      hive,
      record.dir,
    );

    let result = await generator.next();
    while (!result.done) {
      logStreamEvent(result.value);
      send(result.value.type, result.value);
      result = await generator.next();
    }

    const repository = getDraftRepository(hive);
    await repository.save({ ...record, updatedAt: new Date().toISOString() });
  });
}
