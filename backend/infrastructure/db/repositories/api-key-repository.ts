import { eq } from "drizzle-orm";
import type { AppDatabase } from "../orm.ts";
import { apiKeys, type ApiKeyRow, type NewApiKeyRow } from "../schema/index.ts";

export class ApiKeyRepository {
  constructor(private db: AppDatabase) {}

  findAll(): Promise<ApiKeyRow[]> {
    return this.db.select().from(apiKeys).orderBy(apiKeys.createdAt);
  }

  async findById(id: string): Promise<ApiKeyRow | undefined> {
    const [row] = await this.db.select().from(apiKeys).where(eq(apiKeys.id, id));
    return row;
  }

  async create(row: NewApiKeyRow): Promise<ApiKeyRow> {
    const [result] = await this.db.insert(apiKeys).values(row).returning();
    return result;
  }

  async update(
    id: string,
    data: Partial<Pick<NewApiKeyRow, "alias" | "last4">>,
  ): Promise<void> {
    await this.db
      .update(apiKeys)
      .set({ ...data, updatedAt: Date.now() })
      .where(eq(apiKeys.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(apiKeys).where(eq(apiKeys.id, id));
  }
}
