import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const pluginConfig = sqliteTable("plugin_config", {
  id: text("id").primaryKey(),
  pluginName: text("plugin_name").notNull(),
  key: text("key").notNull(),
  last4: text("last4").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type PluginConfigRow = typeof pluginConfig.$inferSelect;
export type NewPluginConfigRow = typeof pluginConfig.$inferInsert;
