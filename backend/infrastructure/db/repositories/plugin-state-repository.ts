import { eq } from "drizzle-orm";
import type { AppDatabase } from "../orm.ts";
import { pluginStates } from "../schema/plugin_states.ts";

export class PluginStateRepository {
  constructor(private db: AppDatabase) {}

  async findAll(): Promise<Map<string, boolean>> {
    const rows = await this.db.select().from(pluginStates);
    return new Map(rows.map((row) => [row.name, row.active === 1]));
  }

  async setActive(name: string, active: boolean): Promise<void> {
    await this.db
      .insert(pluginStates)
      .values({ name, active: active ? 1 : 0 })
      .onConflictDoUpdate({
        target: pluginStates.name,
        set: { active: active ? 1 : 0 },
      });
  }

  async delete(name: string): Promise<void> {
    await this.db.delete(pluginStates).where(eq(pluginStates.name, name));
  }
}
