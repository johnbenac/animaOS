import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { DB_PATH, MIGRATIONS_DIR, ensureRuntimeLayout } from "../lib/runtime-paths";

await ensureRuntimeLayout();

const sqlite = new Database(DB_PATH);
const db = drizzle(sqlite);

migrate(db, { migrationsFolder: MIGRATIONS_DIR });

console.log("✅ Database migrated");
sqlite.close();
