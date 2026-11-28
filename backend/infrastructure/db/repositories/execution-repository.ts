import { count, eq, desc } from "drizzle-orm";
import type { AppDatabase } from "../orm.ts";
import { knownKeyId } from "./known-key.ts";
import {
  chats,
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

function toGraph(row: typeof executionGraphs.$inferSelect): ExecutionGraph {
  const {
    orchestratorProvider,
    orchestratorModel,
    orchestratorKeyId,
    ...rest
  } = row;
  return {
    ...rest,
    orchestrator: orchestratorProvider && orchestratorModel
      ? {
        provider: orchestratorProvider,
        model: orchestratorModel,
        ...(orchestratorKeyId ? { keyId: orchestratorKeyId } : {}),
      }
      : null,
  };
}

export class ExecutionRepository {
  constructor(private db: AppDatabase) {}

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
    // Older databases created chats.executionId without ON DELETE CASCADE
    // (the column was added by an earlier version of migration 0008), so the
    // FK would block the delete. Remove the execution's chats explicitly.
    await this.db.delete(chats).where(eq(chats.executionId, id));
    await this.db.delete(executions).where(eq(executions.id, id));
  }

  async findLatestGraphs(): Promise<
    { execution: Execution; graph: ExecutionGraph }[]
  > {
    const all = await this.findAll();
    const result: { execution: Execution; graph: ExecutionGraph }[] = [];
    for (const execution of all) {
      if (!execution.lastGraphId) continue;
      const graph = await this.findGraphById(execution.lastGraphId);
      if (graph) result.push({ execution, graph });
    }
    return result;
  }

  async findGraphById(id: number): Promise<ExecutionGraph | undefined> {
    const [graph] = await this.db.select().from(executionGraphs).where(eq(executionGraphs.id, id));
    return graph ? toGraph(graph) : undefined;
  }

  async createGraph(graph: NewExecutionGraph): Promise<ExecutionGraph> {
    const { orchestrator, ...columns } = graph;
    const [result] = await this.db
      .insert(executionGraphs)
      .values({
        ...columns,
        orchestratorProvider: orchestrator?.provider ?? null,
        orchestratorModel: orchestrator?.model ?? null,
        orchestratorKeyId: await knownKeyId(this.db, orchestrator?.keyId),
      })
      .returning();
    return toGraph(result);
  }

  async createHistory(history: NewExecutionHistory): Promise<ExecutionHistory> {
    const [result] = await this.db
      .insert(executionHistory)
      .values(history)
      .returning();
    return result;
  }

  async countHistories(executionId: number): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(executionHistory)
      .where(eq(executionHistory.executionId, executionId));
    return row?.total ?? 0;
  }
  
  async findHistoriesByExecutionId(
    executionId: number,
  ): Promise<ExecutionHistory[]> {
    return await this.db
      .select()
      .from(executionHistory)
      .where(eq(executionHistory.executionId, executionId))
      .orderBy(desc(executionHistory.iteration));
  }

  async findHistoryById(id: number): Promise<ExecutionHistory | undefined> {
    const [history] = await this.db
      .select()
      .from(executionHistory)
      .where(eq(executionHistory.id, id));
    return history;
  }
}

