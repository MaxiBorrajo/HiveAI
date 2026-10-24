import { eq, and } from "drizzle-orm";
import type { AppDatabase } from "../orm.ts";
import {
  pluginConfig,
  type PluginConfigRow,
  type NewPluginConfigRow,
} from "../schema/index.ts";

export class PluginConfigRepository {
  constructor(private db: AppDatabase) {}

  findByPlugin(pluginName: string): Promise<PluginConfigRow[]> {
    return this.db
      .select()
      .from(pluginConfig)
      .where(eq(pluginConfig.pluginName, pluginName));
  }

  async findOne(
    pluginName: string,
    key: string,
  ): Promise<PluginConfigRow | undefined> {
    const [row] = await this.db
      .select()
      .from(pluginConfig)
      .where(
        and(eq(pluginConfig.pluginName, pluginName), eq(pluginConfig.key, key)),
      );
    return row;
  }

  async upsert(row: NewPluginConfigRow): Promise<PluginConfigRow> {
    const [result] = await this.db
      .insert(pluginConfig)
      .values(row)
      .onConflictDoUpdate({
        target: pluginConfig.id,
        set: { last4: row.last4, updatedAt: row.updatedAt },
      })
      .returning();
    return result;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(pluginConfig).where(eq(pluginConfig.id, id));
  }
}
