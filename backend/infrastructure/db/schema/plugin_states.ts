import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const pluginStates = sqliteTable("plugin_states", {
  name: text("name").primaryKey(),
  active: integer("active").notNull(),
});

export type PluginState = typeof pluginStates.$inferSelect;
export type NewPluginState = typeof pluginStates.$inferInsert;
