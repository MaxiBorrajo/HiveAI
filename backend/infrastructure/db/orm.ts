import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { migrate } from "drizzle-orm/sqlite-proxy/migrator";
import * as schema from "./schema/index.ts";

export type AppDatabase = SqliteRemoteDatabase<typeof schema> & {
  $client: DatabaseSync;
};

let dbInstance: AppDatabase | null = null;

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function initORM(dataDir: string): Promise<AppDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

  const dbDir = join(dataDir, "memory");
  mkdirSync(dbDir, { recursive: true });
  const dbPath = join(dbDir, "hiveai.db");
console.log(dbPath)
  const client = new DatabaseSync(dbPath);
  client.exec("PRAGMA foreign_keys = ON;");

  const db = drizzle(
    async (sql, params, method) => {
      const stmt = client.prepare(sql);
      if (method === "run") {
        stmt.run(...params);
        return { rows: [] };
      } else if (method === "get") {
        const row = stmt.get(...params);
        return {
          rows: row ? Object.values(row as object) : (undefined as any),
        };
      } else {
        const rows = stmt.all(...params);
        return { rows: rows.map((r) => Object.values(r as object)) };
      }
    },
    { schema },
  ) as AppDatabase;

  db.$client = client;

  // Run pending Drizzle migrations automatically
  const migrationsFolder = join(__dirname, "migrations");
  await migrate(
    db,
    async (queries) => {
      for (const query of queries) {
        client.exec(query);
      }
    },
    { migrationsFolder },
  );

  // Initialize FTS5 virtual table and synchronization triggers
  schema.initializeFts(client);

  dbInstance = db;
  return dbInstance;
}

export function getORM(): AppDatabase {
  if (!dbInstance) {
    throw new Error("Database has not been initialized. Call initORM first.");
  }
  return dbInstance;
}
