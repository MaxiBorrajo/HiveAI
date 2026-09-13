import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { getDraftRepository } from "../../draft-context.ts";
import { ResponseBuilder } from "../../../../core/api/response.ts";

export async function handleListDrafts(
  hive: HiveMicrokernel,
  headers: Record<string, string>,
): Promise<Response> {
  const drafts = await getDraftRepository(hive).list();
  return ResponseBuilder.success({ drafts }, { headers });
}
