import { ResponseBuilder } from "../../../core/api/response.ts";
import { stagingDirFor } from "./generate-plugin-draft.ts";

export async function discardPluginDraft(
  sessionId: string,
  headers: Record<string, string>,
): Promise<Response> {
  await Deno.remove(stagingDirFor(sessionId), { recursive: true }).catch(() => {});
  return ResponseBuilder.success({ sessionId }, { headers });
}
