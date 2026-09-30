import { eq, desc } from "drizzle-orm";
import type { AppDatabase } from "../orm.ts";
import {
  executions,
  executionGraphs,
  executionHistory,
  type Execution,
  type NewExecution,
  type ExecutionGraph,
  type NewExecutionGraph,
  type ExecutionHistory,
  type NewExecutionHistory,
} from "../schema/index.ts";

export class ExecutionRepository {
  constructor(private db: AppDatabase) {}

  // Executions
  async findAll(): Promise<Execution[]> {
    return await this.db.select().from(executions).orderBy(desc(executions.updatedAt));
  }

  async findById(id: number): Promise<Execution | undefined> {
    const [execution] = await this.db.select().from(executions).where(eq(executions.id, id));
    return execution;
  }

  async create(execution: NewExecution): Promise<Execution> {
    const [result] = await this.db
      .insert(executions)
      .values(execution)
      .returning();
    return result;
  }

  async update(id: number, data: Partial<NewExecution>): Promise<void> {
    await this.db
      .update(executions)
      .set({ ...data, updatedAt: Date.now() })
      .where(eq(executions.id, id));
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(executions).where(eq(executions.id, id));
  }

  // Execution Graphs
  async findGraphById(id: number): Promise<ExecutionGraph | undefined> {
    const [graph] = await this.db.select().from(executionGraphs).where(eq(executionGraphs.id, id));
    return graph;
  }

  async createGraph(graph: NewExecutionGraph): Promise<ExecutionGraph> {
    const [result] = await this.db
      .insert(executionGraphs)
      .values(graph)
      .returning();
    return result;
  }

  // Execution History
  async createHistory(history: NewExecutionHistory): Promise<ExecutionHistory> {
    const [result] = await this.db
      .insert(executionHistory)
      .values(history)
      .returning();
    return result;
  }

  async countHistories(executionId: number): Promise<number> {
    const records = await this.db
      .select()
      .from(executionHistory)
      .where(eq(executionHistory.executionId, executionId));
    return records.length;
  }

  async findHistoryById(id: number): Promise<ExecutionHistory | undefined> {
    const [history] = await this.db
      .select()
      .from(executionHistory)
      .where(eq(executionHistory.id, id));
    return history;
  }
}

