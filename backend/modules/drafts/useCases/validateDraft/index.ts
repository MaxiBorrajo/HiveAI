import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { validateDraftPlugin } from "../../../../core/microkernel/drafts/validate-draft.ts";
import { getDraftRepository } from "../../draft-context.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";

export async function handleValidateDraft(
  hive: HiveMicrokernel,
  name: string,
  headers: Record<string, string>,
): Promise<Response> {
  const record = await getDraftRepository(hive).get(name);
  if (!record) {
    return ResponseBuilder.error(["Draft not found."], undefined, {
      status: 404,
      headers,
    });
  }

  const result = await validateDraftPlugin(hive, record.dir);
  return ResponseBuilder.success(result, { headers });
}
