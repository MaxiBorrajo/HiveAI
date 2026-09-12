import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";
import { getDraftRepository } from "../../draft-context.ts";

export async function handleRemoveDraft(
  hive: HiveMicrokernel,
  name: string,
  headers: Record<string, string>,
): Promise<Response> {
  const removed = await getDraftRepository(hive).remove(name);
  return removed
    ? ResponseBuilder.success(undefined, { headers })
    : ResponseBuilder.error(["Draft not found"], undefined, {
        headers,
        status: 404,
      });
}
