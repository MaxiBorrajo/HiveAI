import { desc, eq, max } from "drizzle-orm";
import type { AppDatabase } from "../orm.ts";
import { executionRubrics, type ExecutionRubric } from "../schema/index.ts";

export class RubricRepository {
  constructor(private db: AppDatabase) {}

  async findLatest(executionId: number): Promise<ExecutionRubric | undefined> {
    const [row] = await this.db
      .select()
      .from(executionRubrics)
      .where(eq(executionRubrics.executionId, executionId))
      .orderBy(desc(executionRubrics.version))
      .limit(1);
    return row;
  }

  async findById(id: number): Promise<ExecutionRubric | undefined> {
    const [row] = await this.db
      .select()
      .from(executionRubrics)
      .where(eq(executionRubrics.id, id));
    return row;
  }

  /** Rubrics are immutable: every edit is stored as the next version. */
  async createVersion(
    executionId: number,
    rubric: string,
    reference: string | null,
  ): Promise<ExecutionRubric> {
    const [{ latest }] = await this.db
      .select({ latest: max(executionRubrics.version) })
      .from(executionRubrics)
      .where(eq(executionRubrics.executionId, executionId));
    const [row] = await this.db
      .insert(executionRubrics)
      .values({
        executionId,
        version: (latest ?? 0) + 1,
        rubric,
        reference,
        createdAt: Date.now(),
      })
      .returning();
    return row;
  }
}
