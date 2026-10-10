import { and, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import type { AppDatabase } from "../orm.ts";
import {
  chatUsage,
  executionUsage,
  generationUsage,
  modelUsage,
  type ModelUsage,
  type UsageContextKind,
  type UsageLocation,
  type UsageRole,
  type UsageStatus,
} from "../schema/index.ts";
import type {
  UsageEntry,
  UsageRecorder,
} from "../../../core/ai/usage/usage-recorder.ts";

export interface UsageFilters {
  context?: UsageContextKind;
  chatId?: number;
  messageId?: number;
  executionId?: number;
  historyId?: number;
  nodeId?: string;
  groupId?: string;
  provider?: string;
  model?: string;
  location?: UsageLocation;
  role?: UsageRole;
  keyId?: string;
  status?: UsageStatus;
  from?: number;
  to?: number;
  limit: number;
  offset: number;
}

export type UsageRecordContext =
  | { kind: "chat"; chatId: number; messageId: number | null }
  | {
      kind: "execution";
      executionId: number;
      historyId: number | null;
      nodeId: string | null;
    }
  | { kind: "graph_generation"; executionId: number | null }
  | { kind: "other" };

export interface UsageRecord extends ModelUsage {
  context: UsageRecordContext;
}

interface JoinedRow {
  usage: ModelUsage;
  chatUsageId: number | null;
  chatId: number | null;
  messageId: number | null;
  executionUsageId: number | null;
  executionId: number | null;
  historyId: number | null;
  nodeId: string | null;
  generationUsageId: number | null;
  generationExecutionId: number | null;
}

// A left-joined table that did not match comes back as nulls, so the link a
// call belongs to is the one whose usage id is present.
function contextOf(row: JoinedRow): UsageRecordContext {
  if (row.chatUsageId != null) {
    return {
      kind: "chat",
      chatId: row.chatId!,
      messageId: row.messageId,
    };
  }
  if (row.executionUsageId != null) {
    return {
      kind: "execution",
      executionId: row.executionId!,
      historyId: row.historyId,
      nodeId: row.nodeId,
    };
  }
  if (row.generationUsageId != null) {
    return {
      kind: "graph_generation",
      executionId: row.generationExecutionId,
    };
  }
  return { kind: "other" };
}

export class ModelUsageRepository implements UsageRecorder {
  constructor(private db: AppDatabase) {}

  async record({ usage, link }: UsageEntry): Promise<void> {
    const [row] = await this.db
      .insert(modelUsage)
      .values(usage)
      .returning({ id: modelUsage.id });
    const usageId = row.id;

    switch (link.kind) {
      case "chat":
        await this.db
          .insert(chatUsage)
          .values({ usageId, chatId: link.chatId });
        break;
      case "execution":
        await this.db.insert(executionUsage).values({
          usageId,
          executionId: link.executionId,
          nodeId: link.nodeId,
        });
        break;
      case "graph_generation":
        await this.db
          .insert(generationUsage)
          .values({ usageId, executionId: link.executionId });
        break;
      case "other":
        break;
    }
  }

  private idsOfGroup(groupId: string) {
    return this.db
      .select({ id: modelUsage.id })
      .from(modelUsage)
      .where(eq(modelUsage.groupId, groupId));
  }

  // The assistant message only exists after the stream ends, so the calls made
  // for it are linked afterwards through their group.
  async attachMessage(groupId: string, messageId: number): Promise<void> {
    await this.db
      .update(chatUsage)
      .set({ messageId })
      .where(
        and(
          inArray(chatUsage.usageId, this.idsOfGroup(groupId)),
          isNull(chatUsage.messageId),
        ),
      );
  }

  async attachHistory(groupId: string, historyId: number): Promise<void> {
    await this.db
      .update(executionUsage)
      .set({ historyId })
      .where(
        and(
          inArray(executionUsage.usageId, this.idsOfGroup(groupId)),
          isNull(executionUsage.historyId),
        ),
      );
  }

  // Every call of a chat, unpaginated: the conversation totals need them all.
  listByChat(chatId: number): Promise<UsageRecord[]> {
    return this.query([eq(chatUsage.chatId, chatId)]);
  }

  list(filters: UsageFilters): Promise<UsageRecord[]> {
    const conditions: SQL[] = [];
    const add = (condition: SQL | undefined) => {
      if (condition) conditions.push(condition);
    };
    const { context, chatId, messageId, executionId, historyId } = filters;

    if (context) add(eq(modelUsage.contextKind, context));
    if (chatId !== undefined) add(eq(chatUsage.chatId, chatId));
    if (messageId !== undefined) add(eq(chatUsage.messageId, messageId));
    if (executionId !== undefined) {
      add(
        or(
          eq(executionUsage.executionId, executionId),
          eq(generationUsage.executionId, executionId),
        ),
      );
    }
    if (historyId !== undefined) add(eq(executionUsage.historyId, historyId));
    if (filters.nodeId) add(eq(executionUsage.nodeId, filters.nodeId));
    if (filters.groupId) add(eq(modelUsage.groupId, filters.groupId));
    if (filters.provider) add(eq(modelUsage.provider, filters.provider));
    if (filters.model) add(eq(modelUsage.model, filters.model));
    if (filters.location) add(eq(modelUsage.location, filters.location));
    if (filters.role) add(eq(modelUsage.role, filters.role));
    if (filters.keyId) add(eq(modelUsage.keyId, filters.keyId));
    if (filters.status) add(eq(modelUsage.status, filters.status));
    if (filters.from !== undefined) add(gte(modelUsage.createdAt, filters.from));
    if (filters.to !== undefined) add(lte(modelUsage.createdAt, filters.to));

    return this.query(conditions, filters);
  }

  private async query(
    conditions: SQL[],
    page?: { limit: number; offset: number },
  ): Promise<UsageRecord[]> {
    // The sqlite proxy turns each row into an object before positional
    // mapping, so two selected columns with the same name would collapse into
    // one. The columns the link tables share (usage_id, execution_id) are
    // aliased to stay distinct.
    const base = this.db
      .select({
        usage: modelUsage,
        chatUsageId: sql<number | null>`${chatUsage.usageId}`.as("chat_usage_id"),
        chatId: chatUsage.chatId,
        messageId: chatUsage.messageId,
        executionUsageId: sql<number | null>`${executionUsage.usageId}`.as(
          "execution_usage_id",
        ),
        executionId: sql<number | null>`${executionUsage.executionId}`.as(
          "execution_link_execution_id",
        ),
        historyId: executionUsage.historyId,
        nodeId: executionUsage.nodeId,
        generationUsageId: sql<number | null>`${generationUsage.usageId}`.as(
          "generation_usage_id",
        ),
        generationExecutionId: sql<number | null>`${generationUsage.executionId}`
          .as("generation_link_execution_id"),
      })
      .from(modelUsage)
      .leftJoin(chatUsage, eq(chatUsage.usageId, modelUsage.id))
      .leftJoin(executionUsage, eq(executionUsage.usageId, modelUsage.id))
      .leftJoin(generationUsage, eq(generationUsage.usageId, modelUsage.id))
      .where(and(...conditions))
      .orderBy(desc(modelUsage.createdAt), desc(modelUsage.id));
    const rows: JoinedRow[] = await (page
      ? base.limit(page.limit).offset(page.offset)
      : base);

    return rows.map((row) => ({ ...row.usage, context: contextOf(row) }));
  }
}
