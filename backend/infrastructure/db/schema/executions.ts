import {
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { apiKeys } from "./api_keys.ts";

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
  graph: text("graph", { mode: "json" }).notNull(),
  state: text("state", { mode: "json" }).notNull(),
  /** Model the graph was generated with; all three are null when unknown. */
  orchestratorProvider: text("orchestratorProvider"),
  orchestratorModel: text("orchestratorModel"),
  orchestratorKeyId: text("orchestratorKeyId").references(() => apiKeys.id, {
    onDelete: "set null",
  }),
  createdAt: integer("createdAt").notNull(),
});

export const executionHistory = sqliteTable("execution_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  executionId: integer("executionId")
    .notNull()
    .references((): AnySQLiteColumn => executions.id, { onDelete: "cascade" }),
  iteration: integer("iteration").notNull(),
  result: text("result", { mode: "json" }).notNull(),
  /** The graph version this run was made with. */
  graphId: integer("graphId").references(
    (): AnySQLiteColumn => executionGraphs.id,
    { onDelete: "set null" },
  ),
  createdAt: integer("createdAt").notNull(),
});

export type Execution = typeof executions.$inferSelect;
export type NewExecution = typeof executions.$inferInsert;

export type Orchestrator = {
  provider: string;
  model: string;
  keyId?: string;
};

type ExecutionGraphRow = typeof executionGraphs.$inferSelect;
type OrchestratorColumns =
  | "orchestratorProvider"
  | "orchestratorModel"
  | "orchestratorKeyId";

/** A stored graph with its orchestrator columns folded back into one object. */
export type ExecutionGraph = Omit<ExecutionGraphRow, OrchestratorColumns> & {
  orchestrator: Orchestrator | null;
};
export type NewExecutionGraph =
  & Omit<typeof executionGraphs.$inferInsert, OrchestratorColumns>
  & { orchestrator?: Orchestrator | null };

export type ExecutionHistory = typeof executionHistory.$inferSelect;
export type NewExecutionHistory = typeof executionHistory.$inferInsert;
