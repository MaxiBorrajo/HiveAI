import { eq } from "drizzle-orm";
import type { AppDatabase } from "../orm.ts";
import { apiKeys } from "../schema/api_keys.ts";

/**
 * The id if that key still exists, otherwise null. Records that mention a key
 * (usage, grades, the model a graph was built with) outlive it: they keep the
 * alias or provider/model and just lose the reference.
 */
export async function knownKeyId(
  db: AppDatabase,
  keyId: string | null | undefined,
): Promise<string | null> {
  if (!keyId) return null;
  const [key] = await db.select({ id: apiKeys.id }).from(apiKeys)
    .where(eq(apiKeys.id, keyId));
  return key ? keyId : null;
}
