import { createGeneratedFile } from "../../../../core/attachments/generated-files.ts";
import type { ExecutionResult } from "../../../../core/ai/visual-builder/types.ts";
import type { AttachmentRepository } from "../../../../infrastructure/db/repositories/attachment-repository.ts";

/**
 * Some local models write their reasoning into the answer as <think> blocks,
 * and an unfinished one runs to the end. None of it belongs in a deliverable.
 */
export function withoutReasoning(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<think>[\s\S]*$/, "")
    .trim();
}

/**
 * A run whose end node delivers a file that no plugin wrote to disk gets it
 * built from the result text, in the format its name asks for, and attached
 * to the run like the files plugins write. A failure leaves the text result
 * and is reported, without failing the run.
 */
export async function createDeliverableFiles(
  dataDir: string,
  repo: AttachmentRepository,
  executionId: number,
  executionHistoryId: number,
  result: ExecutionResult | undefined,
  warn: (message: string) => void,
): Promise<number> {
  const names = result?.metadata?.deliverableFiles;
  if (!Array.isArray(names) || typeof result?.content !== "string") return 0;
  const content = withoutReasoning(result.content);

  const context = {
    dataDir,
    repo,
    executionId,
    executionHistoryId,
    files: [],
    onFailure: warn,
  };
  for (const name of names) {
    try {
      await createGeneratedFile(context, String(name), content);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      warn(`Could not create '${name}': ${detail}`);
    }
  }
  return context.files.length;
}
