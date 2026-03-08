import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";
import {
  DB_PATH,
  MIGRATIONS_DIR,
  ensureRuntimeLayoutSync,
} from "../lib/runtime-paths";

ensureRuntimeLayoutSync();
const sqlite = new Database(DB_PATH);
export const db = drizzle(sqlite, { schema });

migrate(db, { migrationsFolder: MIGRATIONS_DIR });
