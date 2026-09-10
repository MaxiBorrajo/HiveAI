import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { getDraftRepository } from "../../draft-context.ts";

export async function handleListDrafts(
  hive: HiveMicrokernel,
  headers: Record<string, string>,
): Promise<Response> {
  const drafts = await getDraftRepository(hive).list();
  return Response.json({ drafts }, { headers });
}
