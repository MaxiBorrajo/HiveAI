import { join } from "node:path";
import { createSseResponse } from "../../../core/api/sse.ts";
import { HiveMicrokernel } from "../../../core/microkernel/hive-microkernel.ts";
import { generateIncrementalPlugin } from "../../../core/ai/plugin-builder/generate-plugin.ts";
import type { IncrementalPluginEvent, PluginDraft } from "../../../core/ai/plugin-builder/types.ts";
import { writeDraftToDir } from "../../../core/ai/plugin-builder/plugin-validator.ts";
import { homeDir } from "../../../core/env.ts";

const LOG = "[Plugin Builder]";
const MAX_PROMPT_LOG_LENGTH = 100;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

export function stagingDirFor(sessionId: string): string {
  return join(homeDir!, ".hiveai", "storage", "plugin-builder-staging", sessionId);
}

function logStreamEvent(event: IncrementalPluginEvent): void {
  switch (event.type) {
    case "planning":
      console.log(`${LOG} [planning] "${event.thoughts}"`);
      break;
    case "signature_drafted":
      console.log(`${LOG} [signature_drafted] "${event.signature.name}"`);
      break;
    case "validation_error":
      console.log(`${LOG} [validation_error] attempt ${event.attempt}: ${event.issues.join("; ")}`);
      break;
  }
}

export async function generatePluginDraft(
  hive: HiveMicrokernel,
  model: string,
  content: string | undefined,
  sessionId: string | undefined,
  currentDraft: PluginDraft | undefined,
  headers: Record<string, string>,
): Promise<Response> {
  return createSseResponse(headers, async (send) => {
    if (!content) {
      send("error", { message: "Missing 'content' in request body." });
      return;
    }

    console.log(
      `${LOG} Model: "${model}" | Session: ${sessionId ?? "new"} | Prompt: "${truncate(content, MAX_PROMPT_LOG_LENGTH)}"`,
    );

    const targetSessionId = sessionId ?? crypto.randomUUID();
    if (!sessionId) send("session_created", { sessionId: targetSessionId });

    const existingPluginNames = hive
      .getRegisteredPlugins()
      .map((p) => p.name);
    const stagingDir = stagingDirFor(targetSessionId);

    const generator = generateIncrementalPlugin(
      content,
      model,
      existingPluginNames,
      hive,
      stagingDir,
    );

    let result = await generator.next();
    while (!result.done) {
      logStreamEvent(result.value);
      send(result.value.type, result.value);
      result = await generator.next();
    }

    const { draft, sourceCode, qualityReport } = result.value;
    await Deno.writeTextFile(
      join(stagingDir, "draft.json"),
      JSON.stringify(draft, null, 2),
    );

    send("done", { sessionId: targetSessionId, draft, sourceCode, qualityReport });
  });
}

export { writeDraftToDir };
