import type { HiveMicrokernel } from "../../../../core/microkernel/hive-microkernel.ts";
import { getDraftRepository } from "../../draft-context.ts";

export async function handleRemoveDraft(
  hive: HiveMicrokernel,
  name: string,
  headers: Record<string, string>,
): Promise<Response> {
  const removed = await getDraftRepository(hive).remove(name);
  return Response.json({ success: removed }, { headers, status: removed ? 200 : 404 });
}
