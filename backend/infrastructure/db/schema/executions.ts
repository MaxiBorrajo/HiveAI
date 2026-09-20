import {
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

export const executions = sqliteTable("executions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  lastResultId: integer("lastResultId").references(
    (): AnySQLiteColumn => executionHistory.id,
  ),
  lastGraphId: integer("lastGraphId").references(
    (): AnySQLiteColumn => executionGraphs.id,
  ),
  createdAt: integer("createdAt").notNull(),
  updatedAt: integer("updatedAt").notNull(),
});

export const executionGraphs = sqliteTable("execution_graphs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  executionId: integer("executionId")
    .notNull()
    .references((): AnySQLiteColumn => executions.id, { onDelete: "cascade" }),
  // JSON representing LangGraphAbstraction (nodes and edges)
  graph: text("graph", { mode: "json" }).notNull(),
  // JSON representing State Schema
  state: text("state", { mode: "json" }).notNull(),
  createdAt: integer("createdAt").notNull(),
});

export const executionHistory = sqliteTable("execution_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  executionId: integer("executionId")
    .notNull()
    .references((): AnySQLiteColumn => executions.id, { onDelete: "cascade" }),
  iteration: integer("iteration").notNull(),
  // JSON representing the actual execution state values at this iteration
  result: text("result", { mode: "json" }).notNull(),
  version: integer("version").notNull().default(1),
  createdAt: integer("createdAt").notNull(),
});

export type Execution = typeof executions.$inferSelect;
export type NewExecution = typeof executions.$inferInsert;

export type ExecutionGraph = typeof executionGraphs.$inferSelect;
export type NewExecutionGraph = typeof executionGraphs.$inferInsert;

export type ExecutionHistory = typeof executionHistory.$inferSelect;
export type NewExecutionHistory = typeof executionHistory.$inferInsert;
