import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { migrate } from "drizzle-orm/sqlite-proxy/migrator";
import { homeDir } from "./main.ts";

const dbDir = join(homeDir!, ".hiveai", "storage", "memory");
const dbPath = join(dbDir, "hiveai.db");

const client = new DatabaseSync(dbPath);
const db = drizzle(async (sql, params, method) => {
  const stmt = client.prepare(sql);
  if (method === "run") { stmt.run(...params); return { rows: [] }; }
  const rows = stmt.all(...params);
  return { rows: rows.map(r => Object.values(r as object)) };
});

const migrationsFolder = join(Deno.cwd(), "infrastructure", "db", "migrations");

await migrate(db, async (queries) => {
  for (const query of queries) {
    console.log("Running query:", query.substring(0, 50) + "...");
    client.exec(query);
  }
}, { migrationsFolder });

console.log("Migration applied successfully!");
