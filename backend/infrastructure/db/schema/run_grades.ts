import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { executionHistory, executions } from "./executions.ts";

export const executionRubrics = sqliteTable(
  "execution_rubrics",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    executionId: integer("executionId")
      .notNull()
      .references((): AnySQLiteColumn => executions.id, {
        onDelete: "cascade",
      }),
    version: integer("version").notNull(),
    rubric: text("rubric").notNull(),
    reference: text("reference"),
    createdAt: integer("createdAt").notNull(),
  },
  (t) => [
    uniqueIndex("execution_rubrics_execution_version_idx").on(
      t.executionId,
      t.version,
    ),
  ],
);

export const GRADE_STATUSES = ["graded", "failed"] as const;
export type GradeStatus = (typeof GRADE_STATUSES)[number];

export const runGrades = sqliteTable(
  "run_grades",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    historyId: integer("historyId")
      .notNull()
      .references((): AnySQLiteColumn => executionHistory.id, {
        onDelete: "cascade",
      }),
    rubricId: integer("rubricId")
      .notNull()
      .references((): AnySQLiteColumn => executionRubrics.id, {
        onDelete: "cascade",
      }),
    judgeProvider: text("judgeProvider").notNull(),
    judgeModel: text("judgeModel").notNull(),
    judgeKeyId: text("judgeKeyId"),
    judgeVersion: integer("judgeVersion").notNull(),
    status: text("status").$type<GradeStatus>().notNull(),
    score: integer("score"),
    reasoning: text("reasoning"),
    error: text("error"),
    createdAt: integer("createdAt").notNull(),
  },
  (t) => [
    uniqueIndex("run_grades_run_rubric_judge_idx").on(
      t.historyId,
      t.rubricId,
      t.judgeProvider,
      t.judgeModel,
    ),
  ],
);

export type ExecutionRubric = typeof executionRubrics.$inferSelect;
export type NewExecutionRubric = typeof executionRubrics.$inferInsert;
export type RunGrade = typeof runGrades.$inferSelect;
export type NewRunGrade = typeof runGrades.$inferInsert;
