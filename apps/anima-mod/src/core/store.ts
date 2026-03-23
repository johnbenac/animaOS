/**
 * a-mod: Module Store
 * 
 * SQLite-backed KV store for module-private data.
 */

import type { ModStore } from "./types.js";
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class ModStoreImpl implements ModStore {
  private db: Database | null = null;
  private namespace: string;
  private dbPath: string;

  constructor(modId: string, dbPath: string) {
    this.namespace = modId;
    this.dbPath = dbPath;
  }

  async init(): Promise<void> {
    // Ensure directory exists
    mkdirSync(dirname(this.dbPath), { recursive: true });
    
    this.db = new Database(this.dbPath);
    
    // Create table if not exists
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mod_store (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (namespace, key)
      )
    `);
  }

  private getDb(): Database {
    if (!this.db) throw new Error("Store not initialized");
    return this.db;
  }

  async get<T>(key: string): Promise<T | null> {
    const db = this.getDb();
    const stmt = db.prepare(
      "SELECT value FROM mod_store WHERE namespace = ? AND key = ?"
    );
    const row = stmt.get(this.namespace, key) as { value: string } | undefined;
    
    if (!row) return null;
    return JSON.parse(row.value) as T;
  }

  async set<T>(key: string, value: T): Promise<void> {
    const db = this.getDb();
    const stmt = db.prepare(
      `INSERT INTO mod_store (namespace, key, value, updated_at) 
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(namespace, key) 
       DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    );
    stmt.run(this.namespace, key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    const db = this.getDb();
    const stmt = db.prepare(
      "DELETE FROM mod_store WHERE namespace = ? AND key = ?"
    );
    stmt.run(this.namespace, key);
  }

  async has(key: string): Promise<boolean> {
    const db = this.getDb();
    const stmt = db.prepare(
      "SELECT 1 FROM mod_store WHERE namespace = ? AND key = ?"
    );
    const row = stmt.get(this.namespace, key);
    return row != null;
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db?.close();
    this.db = null;
  }
}
