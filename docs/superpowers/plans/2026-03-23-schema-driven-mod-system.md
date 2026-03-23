# Schema-Driven Module System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a schema-driven management layer to anima-mod and a Mods page to the desktop UI so users can configure, enable/disable, and monitor external integrations from the desktop app.

**Architecture:** anima-mod gets its own Drizzle/SQLite database for mod config/state/events, a management API (`/api/mods/*`), and WebSocket event stream. Mods declare `configSchema` and `setupGuide` — the desktop renders forms dynamically from these schemas. An Eden Treaty client package provides type-safe desktop-to-anima-mod communication.

**Tech Stack:** Elysia, Drizzle ORM (bun:sqlite), Eden Treaty, React, TailwindCSS, Alembic (Python side)

---

## File Map

### anima-mod: Database Layer
- **Create:** `apps/anima-mod/src/db/schema.ts` — Drizzle table definitions (mod_config, mod_state, mod_events, mod_store)
- **Create:** `apps/anima-mod/src/db/index.ts` — Database connection, migration runner
- **Create:** `apps/anima-mod/drizzle.config.ts` — Drizzle Kit config for generating migrations

### anima-mod: Schema Types
- **Modify:** `apps/anima-mod/src/core/types.ts` — Add `ModConfigSchema`, `ConfigField`, `SetupStep`, extend `Mod` interface

### anima-mod: Management Layer
- **Create:** `apps/anima-mod/src/management/config-service.ts` — CRUD for mod config (DB read/write, schema validation, secret masking)
- **Create:** `apps/anima-mod/src/management/state-service.ts` — Mod lifecycle state tracking (started/stopped/error)
- **Create:** `apps/anima-mod/src/management/event-service.ts` — Audit log for mod events
- **Create:** `apps/anima-mod/src/management/router.ts` — Elysia management API routes (`/api/mods/*`)
- **Create:** `apps/anima-mod/src/management/ws.ts` — WebSocket event broadcaster
- **Create:** `apps/anima-mod/src/management/installer.ts` — GitHub-based mod install/uninstall

### anima-mod: Registry Refactor
- **Modify:** `apps/anima-mod/src/core/registry.ts` — Per-mod init/start/stop, DB-sourced config, state tracking
- **Modify:** `apps/anima-mod/src/core/context.ts` — Source config from DB instead of YAML
- **Modify:** `apps/anima-mod/src/core/store.ts` — Refactor to use shared Drizzle DB connection
- **Modify:** `apps/anima-mod/src/server.ts` — Mount management router, export App type

### anima-mod: Mod Updates
- **Modify:** `apps/anima-mod/mods/telegram/mod.ts` — Add `configSchema` + `setupGuide`
- **Modify:** `apps/anima-mod/mods/discord/mod.ts` — Add `configSchema` + `setupGuide`
- **Modify:** `apps/anima-mod/mods/echo/mod.ts` — Add minimal `configSchema`

### Eden Treaty Client
- **Create:** `packages/mod-client/package.json`
- **Create:** `packages/mod-client/src/index.ts` — Treaty client factory
- **Create:** `packages/mod-client/tsconfig.json`

### Desktop: Mods Pages
- **Create:** `apps/desktop/src/lib/mod-client.ts` — Mod client instance + React hooks
- **Create:** `apps/desktop/src/pages/Mods.tsx` — Mods hub page (card grid)
- **Create:** `apps/desktop/src/pages/ModDetail.tsx` — Individual mod page (wizard + settings)
- **Create:** `apps/desktop/src/components/mods/ModCard.tsx` — Single mod card component
- **Create:** `apps/desktop/src/components/mods/SetupWizard.tsx` — Vertical stepper wizard
- **Create:** `apps/desktop/src/components/mods/ConfigForm.tsx` — Schema-driven config form
- **Create:** `apps/desktop/src/components/mods/StatusBadge.tsx` — Mod status badge
- **Modify:** `apps/desktop/src/App.tsx` — Add `/mods` and `/mods/:id` routes
- **Modify:** `apps/desktop/src/components/Layout.tsx` — Add MODS nav item to dock

### Desktop: Chat Source Badge
- **Modify:** `packages/api-client/src/index.ts` — Add `source` to `ChatMessage` interface
- **Modify:** `apps/desktop/src/pages/Chat.tsx` — Render source badge on messages

### Python Server: Source Column
- **Create:** `apps/server/alembic/versions/20260323_add_source_to_agent_messages.py` — Alembic migration
- **Modify:** `apps/server/src/anima_server/models/agent_runtime.py` — Add `source` column to AgentMessage model
- **Modify:** `apps/server/src/anima_server/schemas/chat.py` — Add `source` to ChatRequest + ChatHistoryMessage
- **Modify:** `apps/server/src/anima_server/services/agent/service.py` — Thread `source` through run_agent/stream_agent
- **Modify:** `apps/server/src/anima_server/api/routes/chat.py` — Return `source` in history serialization

### Tests
- **Create:** `apps/anima-mod/tests/db/schema.test.ts`
- **Create:** `apps/anima-mod/tests/management/config-service.test.ts`
- **Create:** `apps/anima-mod/tests/management/state-service.test.ts`
- **Create:** `apps/anima-mod/tests/management/router.test.ts`

---

## Task 1: Drizzle Setup + Database Schema

**Files:**
- Create: `apps/anima-mod/src/db/schema.ts`
- Create: `apps/anima-mod/src/db/index.ts`
- Create: `apps/anima-mod/drizzle.config.ts`
- Test: `apps/anima-mod/tests/db/schema.test.ts`
- Modify: `apps/anima-mod/package.json`

- [ ] **Step 1: Install Drizzle dependencies**

```bash
cd apps/anima-mod && bun add drizzle-orm && bun add -d drizzle-kit
```

- [ ] **Step 2: Write the failing test for database schema**

Create `apps/anima-mod/tests/db/schema.test.ts`:

```ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { sql } from "drizzle-orm";
import { modConfig, modState, modEvents, modStore } from "../../src/db/schema.js";

describe("database schema", () => {
  let sqlite: Database;
  let db: ReturnType<typeof drizzle>;

  beforeAll(() => {
    sqlite = new Database(":memory:");
    db = drizzle(sqlite);
    // Push schema to in-memory DB
    sqlite.exec(`
      CREATE TABLE mod_config (
        mod_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        is_secret INTEGER DEFAULT 0,
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (mod_id, key)
      );
      CREATE TABLE mod_state (
        mod_id TEXT PRIMARY KEY,
        enabled INTEGER DEFAULT 0,
        status TEXT DEFAULT 'stopped',
        last_error TEXT,
        started_at TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE mod_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mod_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        detail TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE mod_store (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (namespace, key)
      );
    `);
  });

  afterAll(() => sqlite.close());

  test("mod_config: insert and read", () => {
    db.insert(modConfig).values({
      modId: "telegram",
      key: "token",
      value: JSON.stringify("abc123"),
      isSecret: true,
    }).run();

    const rows = db.select().from(modConfig).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].modId).toBe("telegram");
    expect(rows[0].isSecret).toBe(true);
  });

  test("mod_state: insert and read", () => {
    db.insert(modState).values({
      modId: "telegram",
      enabled: true,
      status: "running",
    }).run();

    const rows = db.select().from(modState).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("running");
  });

  test("mod_events: insert and read", () => {
    db.insert(modEvents).values({
      modId: "telegram",
      eventType: "started",
      detail: JSON.stringify({ version: "1.0.0" }),
    }).run();

    const rows = db.select().from(modEvents).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe("started");
  });

  test("mod_store: insert and read (Drizzle-managed)", () => {
    db.insert(modStore).values({
      namespace: "telegram",
      key: "last_poll",
      value: JSON.stringify(Date.now()),
    }).run();

    const rows = db.select().from(modStore).all();
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/anima-mod && bun test tests/db/schema.test.ts`
Expected: FAIL — cannot resolve `../../src/db/schema.js`

- [ ] **Step 4: Create Drizzle schema**

Create `apps/anima-mod/src/db/schema.ts`:

```ts
import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const modConfig = sqliteTable("mod_config", {
  modId: text("mod_id").notNull(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  isSecret: integer("is_secret", { mode: "boolean" }).default(false),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
}, (table) => [
  primaryKey({ columns: [table.modId, table.key] }),
]);

export const modState = sqliteTable("mod_state", {
  modId: text("mod_id").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).default(false),
  status: text("status").default("stopped").$type<"stopped" | "running" | "error">(),
  lastError: text("last_error"),
  startedAt: text("started_at"),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

export const modEvents = sqliteTable("mod_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  modId: text("mod_id").notNull(),
  eventType: text("event_type").notNull().$type<"config_changed" | "started" | "stopped" | "error">(),
  detail: text("detail"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

export const modStore = sqliteTable("mod_store", {
  namespace: text("namespace").notNull(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
}, (table) => [
  primaryKey({ columns: [table.namespace, table.key] }),
]);
```

- [ ] **Step 5: Create database connection module**

Create `apps/anima-mod/src/db/index.ts`:

```ts
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema.js";

let db: ReturnType<typeof drizzle> | null = null;
let sqlite: Database | null = null;

const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS mod_config (
    mod_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    is_secret INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (mod_id, key)
  );
  CREATE TABLE IF NOT EXISTS mod_state (
    mod_id TEXT PRIMARY KEY,
    enabled INTEGER DEFAULT 0,
    status TEXT DEFAULT 'stopped',
    last_error TEXT,
    started_at TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS mod_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mod_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    detail TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS mod_store (
    namespace TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (namespace, key)
  );
`;

export function getDb(dbPath = "./data/a-mod.db"): ReturnType<typeof drizzle> {
  if (db) return db;

  mkdirSync(dirname(dbPath), { recursive: true });
  sqlite = new Database(dbPath);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec(CREATE_TABLES_SQL);
  db = drizzle(sqlite, { schema });
  return db;
}

export function closeDb(): void {
  sqlite?.close();
  sqlite = null;
  db = null;
}

export { schema };
```

- [ ] **Step 6: Create Drizzle Kit config**

Create `apps/anima-mod/drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: "./data/a-mod.db",
  },
});
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd apps/anima-mod && bun test tests/db/schema.test.ts`
Expected: PASS — all 4 tests pass

- [ ] **Step 8: Commit**

```bash
git add apps/anima-mod/src/db/ apps/anima-mod/drizzle.config.ts apps/anima-mod/tests/db/ apps/anima-mod/package.json apps/anima-mod/bun.lock
git commit -m "feat(anima-mod): add Drizzle ORM schema for mod config, state, events"
```

---

## Task 2: Schema Types (ModConfigSchema, SetupStep)

**Files:**
- Modify: `apps/anima-mod/src/core/types.ts`

- [ ] **Step 1: Add schema types to types.ts**

Add the following types at the end of `apps/anima-mod/src/core/types.ts` (before the closing of the file):

```ts
/** Config field types for schema-driven UI */
export type FieldType = "string" | "number" | "boolean" | "enum" | "secret";

/** Single config field definition */
export interface ConfigField {
  type: FieldType;
  label: string;
  required?: boolean;
  default?: unknown;
  options?: string[];
  showWhen?: Record<string, unknown>;
  description?: string;
}

/** Schema for mod configuration — desktop renders forms from this */
export type ModConfigSchema = Record<string, ConfigField>;

/** Setup wizard step */
export interface SetupStep {
  step: number;
  title: string;
  instructions?: string;
  field?: string;
  action?: "healthcheck";
}
```

- [ ] **Step 2: Extend Mod interface with configSchema and setupGuide**

In `apps/anima-mod/src/core/types.ts`, add two optional fields to the `Mod` interface after `getRouter?()`:

```ts
  /** Config schema for schema-driven UI. Desktop renders settings forms from this. */
  configSchema?: ModConfigSchema;

  /** Optional setup wizard steps. If present, desktop shows wizard for first-time setup. */
  setupGuide?: SetupStep[];
```

- [ ] **Step 3: Run existing tests to verify nothing broke**

Run: `cd apps/anima-mod && bun test`
Expected: All existing tests still pass

- [ ] **Step 4: Commit**

```bash
git add apps/anima-mod/src/core/types.ts
git commit -m "feat(anima-mod): add ModConfigSchema, ConfigField, SetupStep types to Mod interface"
```

---

## Task 3: Config Service (DB CRUD + Schema Validation)

**Files:**
- Create: `apps/anima-mod/src/management/config-service.ts`
- Test: `apps/anima-mod/tests/management/config-service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/anima-mod/tests/management/config-service.test.ts`:

```ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../src/db/schema.js";
import { ConfigService } from "../../src/management/config-service.js";
import type { ModConfigSchema } from "../../src/core/types.js";

const telegramSchema: ModConfigSchema = {
  token: { type: "secret", label: "Bot Token", required: true },
  mode: { type: "enum", label: "Mode", options: ["polling", "webhook"], default: "polling" },
  webhookUrl: { type: "string", label: "Webhook URL", showWhen: { mode: "webhook" } },
};

describe("ConfigService", () => {
  let sqlite: Database;
  let db: ReturnType<typeof drizzle>;
  let service: ConfigService;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE mod_config (
        mod_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
        is_secret INTEGER DEFAULT 0, updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (mod_id, key)
      );
    `);
    db = drizzle(sqlite, { schema });
    service = new ConfigService(db);
  });

  afterEach(() => sqlite.close());

  test("setConfig writes values to DB", async () => {
    await service.setConfig("telegram", { token: "abc123", mode: "polling" }, telegramSchema);
    const config = await service.getConfig("telegram");
    expect(config.mode).toBe("polling");
  });

  test("getConfig masks secrets", async () => {
    await service.setConfig("telegram", { token: "abc123" }, telegramSchema);
    const config = await service.getConfig("telegram", { maskSecrets: true });
    expect(config.token).toBe("***");
  });

  test("getConfig returns raw values when not masking", async () => {
    await service.setConfig("telegram", { token: "abc123" }, telegramSchema);
    const config = await service.getConfig("telegram", { maskSecrets: false });
    expect(config.token).toBe("abc123");
  });

  test("setConfig validates required fields", () => {
    expect(
      service.setConfig("telegram", { mode: "polling" }, telegramSchema)
    ).rejects.toThrow(/required/i);
  });

  test("setConfig validates enum values", () => {
    expect(
      service.setConfig("telegram", { token: "abc", mode: "invalid" }, telegramSchema)
    ).rejects.toThrow(/invalid.*mode/i);
  });

  test("hasConfig returns false for unconfigured mod", async () => {
    expect(await service.hasConfig("telegram")).toBe(false);
  });

  test("hasConfig returns true after config set", async () => {
    await service.setConfig("telegram", { token: "abc" }, telegramSchema);
    expect(await service.hasConfig("telegram")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/anima-mod && bun test tests/management/config-service.test.ts`
Expected: FAIL — cannot resolve `../../src/management/config-service.js`

- [ ] **Step 3: Implement ConfigService**

Create `apps/anima-mod/src/management/config-service.ts`:

```ts
import { eq, and } from "drizzle-orm";
import { modConfig } from "../db/schema.js";
import type { ModConfigSchema, ConfigField } from "../core/types.js";

import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../db/schema.js";

export class ConfigService {
  constructor(private db: BunSQLiteDatabase<typeof schema>) {}

  async getConfig(
    modId: string,
    opts: { maskSecrets?: boolean } = {}
  ): Promise<Record<string, unknown>> {
    const rows = this.db
      .select()
      .from(modConfig)
      .where(eq(modConfig.modId, modId))
      .all();

    const result: Record<string, unknown> = {};
    for (const row of rows) {
      if (opts.maskSecrets && row.isSecret) {
        result[row.key] = "***";
      } else {
        result[row.key] = JSON.parse(row.value);
      }
    }
    return result;
  }

  async setConfig(
    modId: string,
    values: Record<string, unknown>,
    schema?: ModConfigSchema
  ): Promise<void> {
    if (schema) {
      this.validate(values, schema);
    }

    for (const [key, value] of Object.entries(values)) {
      const isSecret = schema?.[key]?.type === "secret";
      this.db
        .insert(modConfig)
        .values({
          modId,
          key,
          value: JSON.stringify(value),
          isSecret,
        })
        .onConflictDoUpdate({
          target: [modConfig.modId, modConfig.key],
          set: {
            value: JSON.stringify(value),
            isSecret,
            updatedAt: new Date().toISOString(),
          },
        })
        .run();
    }
  }

  async hasConfig(modId: string): Promise<boolean> {
    const rows = this.db
      .select()
      .from(modConfig)
      .where(eq(modConfig.modId, modId))
      .all();
    return rows.length > 0;
  }

  private validate(values: Record<string, unknown>, schema: ModConfigSchema): void {
    for (const [key, field] of Object.entries(schema)) {
      const val = values[key];

      // Check required
      if (field.required && (val === undefined || val === null || val === "")) {
        throw new Error(`Field '${key}' is required`);
      }

      // Check enum
      if (val !== undefined && field.type === "enum" && field.options) {
        if (!field.options.includes(String(val))) {
          throw new Error(`Invalid value for '${key}': must be one of ${field.options.join(", ")}`);
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/anima-mod && bun test tests/management/config-service.test.ts`
Expected: PASS — all 7 tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/anima-mod/src/management/config-service.ts apps/anima-mod/tests/management/config-service.test.ts
git commit -m "feat(anima-mod): add ConfigService for schema-validated mod config CRUD"
```

---

## Task 4: State Service + Event Service

**Files:**
- Create: `apps/anima-mod/src/management/state-service.ts`
- Create: `apps/anima-mod/src/management/event-service.ts`
- Test: `apps/anima-mod/tests/management/state-service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/anima-mod/tests/management/state-service.test.ts`:

```ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../src/db/schema.js";
import { StateService } from "../../src/management/state-service.js";
import { EventService } from "../../src/management/event-service.js";

describe("StateService", () => {
  let sqlite: Database;
  let db: ReturnType<typeof drizzle>;
  let stateService: StateService;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE mod_state (
        mod_id TEXT PRIMARY KEY, enabled INTEGER DEFAULT 0,
        status TEXT DEFAULT 'stopped', last_error TEXT,
        started_at TEXT, updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
    db = drizzle(sqlite, { schema });
    stateService = new StateService(db);
  });

  afterEach(() => sqlite.close());

  test("getState returns default for unknown mod", async () => {
    const state = await stateService.getState("telegram");
    expect(state).toBeNull();
  });

  test("setState creates new state", async () => {
    await stateService.setState("telegram", { enabled: true, status: "running" });
    const state = await stateService.getState("telegram");
    expect(state?.enabled).toBe(true);
    expect(state?.status).toBe("running");
  });

  test("setState updates existing state", async () => {
    await stateService.setState("telegram", { enabled: true, status: "running" });
    await stateService.setState("telegram", { status: "error", lastError: "connection lost" });
    const state = await stateService.getState("telegram");
    expect(state?.status).toBe("error");
    expect(state?.lastError).toBe("connection lost");
  });

  test("getAllStates returns all mod states", async () => {
    await stateService.setState("telegram", { enabled: true, status: "running" });
    await stateService.setState("discord", { enabled: false, status: "stopped" });
    const states = await stateService.getAllStates();
    expect(states).toHaveLength(2);
  });
});

describe("EventService", () => {
  let sqlite: Database;
  let db: ReturnType<typeof drizzle>;
  let eventService: EventService;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE mod_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, mod_id TEXT NOT NULL,
        event_type TEXT NOT NULL, detail TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    db = drizzle(sqlite, { schema });
    eventService = new EventService(db);
  });

  afterEach(() => sqlite.close());

  test("logEvent creates event", async () => {
    await eventService.logEvent("telegram", "started", { version: "1.0.0" });
    const events = await eventService.getEvents("telegram");
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe("started");
  });

  test("getEvents returns events in reverse chronological order", async () => {
    await eventService.logEvent("telegram", "started");
    await eventService.logEvent("telegram", "config_changed", { key: "mode" });
    const events = await eventService.getEvents("telegram");
    expect(events).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/anima-mod && bun test tests/management/state-service.test.ts`
Expected: FAIL — cannot resolve modules

- [ ] **Step 3: Implement StateService**

Create `apps/anima-mod/src/management/state-service.ts`:

```ts
import { eq } from "drizzle-orm";
import { modState } from "../db/schema.js";

interface ModState {
  modId: string;
  enabled: boolean;
  status: "stopped" | "running" | "error";
  lastError: string | null;
  startedAt: string | null;
  updatedAt: string | null;
}

import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../db/schema.js";

export class StateService {
  constructor(private db: BunSQLiteDatabase<typeof schema>) {}

  async getState(modId: string): Promise<ModState | null> {
    const rows = this.db
      .select()
      .from(modState)
      .where(eq(modState.modId, modId))
      .all();
    return rows[0] ?? null;
  }

  async setState(modId: string, updates: Partial<Omit<ModState, "modId">>): Promise<void> {
    const existing = await this.getState(modId);

    if (existing) {
      this.db
        .update(modState)
        .set({ ...updates, updatedAt: new Date().toISOString() })
        .where(eq(modState.modId, modId))
        .run();
    } else {
      this.db
        .insert(modState)
        .values({ modId, ...updates })
        .run();
    }
  }

  async getAllStates(): Promise<ModState[]> {
    return this.db.select().from(modState).all();
  }
}
```

- [ ] **Step 4: Implement EventService**

Create `apps/anima-mod/src/management/event-service.ts`:

```ts
import { eq, desc } from "drizzle-orm";
import { modEvents } from "../db/schema.js";

import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "../db/schema.js";

export class EventService {
  constructor(private db: BunSQLiteDatabase<typeof schema>) {}

  async logEvent(
    modId: string,
    eventType: string,
    detail?: Record<string, unknown>
  ): Promise<void> {
    this.db
      .insert(modEvents)
      .values({
        modId,
        eventType,
        detail: detail ? JSON.stringify(detail) : null,
      })
      .run();
  }

  async getEvents(modId: string, limit = 50): Promise<any[]> {
    return this.db
      .select()
      .from(modEvents)
      .where(eq(modEvents.modId, modId))
      .orderBy(desc(modEvents.id))
      .limit(limit)
      .all();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/anima-mod && bun test tests/management/state-service.test.ts`
Expected: PASS — all tests pass

- [ ] **Step 6: Commit**

```bash
git add apps/anima-mod/src/management/state-service.ts apps/anima-mod/src/management/event-service.ts apps/anima-mod/tests/management/state-service.test.ts
git commit -m "feat(anima-mod): add StateService and EventService for mod lifecycle tracking"
```

---

## Task 5: Registry Refactor (Per-Mod Lifecycle + DB Config)

**Files:**
- Modify: `apps/anima-mod/src/core/registry.ts`
- Modify: `apps/anima-mod/src/core/context.ts`
- Modify: `apps/anima-mod/src/core/store.ts`

This is a **refactor** task — no new tests, existing tests must still pass. The registry gains per-mod `initMod(id)`, `startMod(id)`, `stopMod(id)` methods. Config is sourced from DB with YAML fallback for first boot.

- [ ] **Step 1: Update context.ts to accept DB-sourced config**

Modify `apps/anima-mod/src/core/context.ts`. The function `createModContext` should accept an explicit config parameter so the registry can pass DB-sourced config instead of only YAML config:

```ts
// Existing signature:
// export async function createModContext(modId: string, modConfig: Record<string, unknown>)
// No change needed — it already accepts config as a parameter.
// The registry will pass DB config instead of YAML config.
```

No code change needed here — the existing signature already supports this. The change is in how the registry calls it.

- [ ] **Step 2: Refactor registry to support per-mod lifecycle**

In `apps/anima-mod/src/core/registry.ts`, add the following methods and expose internal state needed by the management API:

Add imports at top:
```ts
import { getDb } from "../db/index.js";
import { ConfigService } from "../management/config-service.js";
import { StateService } from "../management/state-service.js";
import { EventService } from "../management/event-service.js";
```

Add to `ModRegistry` class:

```ts
  private configService?: ConfigService;
  private stateService?: StateService;
  private eventService?: EventService;

  /** Initialize management services (call before loadFromConfig) */
  initServices(): void {
    const db = getDb();
    this.configService = new ConfigService(db);
    this.stateService = new StateService(db);
    this.eventService = new EventService(db);
  }

  /** Initialize a single module by ID */
  async initMod(id: string): Promise<void> {
    const loaded = this.mods.get(id);
    if (!loaded?.mod) throw new Error(`Module ${id} not registered`);

    // Get config: DB first, fall back to YAML
    let config = loaded.config.config;
    if (this.configService && await this.configService.hasConfig(id)) {
      config = await this.configService.getConfig(id);
    }

    const ctx = await createModContext(id, config);
    loaded.ctx = ctx;
    await loaded.mod.init(ctx);

    if (loaded.mod.getRouter) {
      loaded.router = loaded.mod.getRouter();
    }

    logger.info("Module initialized", { id });
  }

  /** Start a single module by ID */
  async startMod(id: string): Promise<void> {
    const loaded = this.mods.get(id);
    if (!loaded?.mod) throw new Error(`Module ${id} not registered`);

    await loaded.mod.start();
    await this.stateService?.setState(id, {
      enabled: true,
      status: "running",
      startedAt: new Date().toISOString(),
      lastError: null,
    });
    await this.eventService?.logEvent(id, "started");
    logger.info("Module started", { id });
  }

  /** Stop a single module by ID */
  async stopMod(id: string): Promise<void> {
    const loaded = this.mods.get(id);
    if (!loaded?.mod?.stop) return;

    await loaded.mod.stop();
    await this.stateService?.setState(id, {
      enabled: false,
      status: "stopped",
    });
    await this.eventService?.logEvent(id, "stopped");
    logger.info("Module stopped", { id });
  }

  /** Restart a single module */
  async restartMod(id: string): Promise<void> {
    await this.stopMod(id);
    await this.initMod(id);
    await this.startMod(id);
  }

  /** Get all loaded mods with their metadata for the management API */
  getAll(): Map<string, LoadedMod> {
    return this.mods;
  }

  getConfigService(): ConfigService | undefined {
    return this.configService;
  }

  getStateService(): StateService | undefined {
    return this.stateService;
  }

  getEventService(): EventService | undefined {
    return this.eventService;
  }
```

Update `initAll()` to use `initMod()` internally:

```ts
  async initAll(): Promise<void> {
    logger.info("Initializing modules", { count: this.mods.size });
    const sortedIds = this.sortByDependencies();
    for (const id of sortedIds) {
      try {
        await this.initMod(id);
      } catch (err) {
        logger.error(`Failed to initialize module ${id}`, {
          error: err instanceof Error ? err.message : String(err)
        });
        throw err;
      }
    }
  }
```

Update `startAll()` and `stopAll()` to use per-mod methods:

```ts
  async startAll(): Promise<void> {
    logger.info("Starting modules");
    for (const [id, loaded] of this.mods) {
      if (!loaded.mod) continue;
      try {
        await this.startMod(id);
      } catch (err) {
        logger.error(`Failed to start module ${id}`, {
          error: err instanceof Error ? err.message : String(err)
        });
        await this.stateService?.setState(id, {
          status: "error",
          lastError: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  async stopAll(): Promise<void> {
    logger.info("Stopping modules");
    for (const [id] of this.mods) {
      try {
        await this.stopMod(id);
      } catch (err) {
        logger.error(`Error stopping module ${id}`, {
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  }
```

- [ ] **Step 3: Seed DB from YAML on first boot**

Add a `migrateYamlConfig()` method to `ModRegistry`:

```ts
  /** One-time migration: seed DB config from YAML values for mods that have no DB config yet */
  async migrateYamlConfig(): Promise<void> {
    if (!this.configService) return;

    for (const [id, loaded] of this.mods) {
      const yamlConfig = loaded.config.config;
      if (!yamlConfig || Object.keys(yamlConfig).length === 0) continue;

      const hasDbConfig = await this.configService.hasConfig(id);
      if (hasDbConfig) continue;

      // Seed DB from YAML
      const schema = loaded.mod?.configSchema;
      await this.configService.setConfig(id, yamlConfig, schema);
      logger.warn(`Migrated config for mod '${id}' from YAML to database`);
    }
  }
```

- [ ] **Step 4: Refactor ModStoreImpl to use shared Drizzle DB**

The existing `ModStoreImpl` in `apps/anima-mod/src/core/store.ts` opens its own raw `bun:sqlite` connection to the same DB file. This creates dual-connection issues. Refactor it to use the shared Drizzle connection from `db/index.ts`:

Replace `apps/anima-mod/src/core/store.ts`:

```ts
import type { ModStore } from "./types.js";
import { eq, and } from "drizzle-orm";
import { modStore } from "../db/schema.js";
import { getDb } from "../db/index.js";

export class ModStoreImpl implements ModStore {
  private namespace: string;

  constructor(modId: string) {
    this.namespace = modId;
  }

  async get<T>(key: string): Promise<T | null> {
    const db = getDb();
    const rows = db
      .select()
      .from(modStore)
      .where(and(eq(modStore.namespace, this.namespace), eq(modStore.key, key)))
      .all();
    if (rows.length === 0) return null;
    return JSON.parse(rows[0].value) as T;
  }

  async set<T>(key: string, value: T): Promise<void> {
    const db = getDb();
    db.insert(modStore)
      .values({
        namespace: this.namespace,
        key,
        value: JSON.stringify(value),
      })
      .onConflictDoUpdate({
        target: [modStore.namespace, modStore.key],
        set: {
          value: JSON.stringify(value),
          updatedAt: new Date().toISOString(),
        },
      })
      .run();
  }

  async delete(key: string): Promise<void> {
    const db = getDb();
    db.delete(modStore)
      .where(and(eq(modStore.namespace, this.namespace), eq(modStore.key, key)))
      .run();
  }

  async has(key: string): Promise<boolean> {
    const db = getDb();
    const rows = db
      .select()
      .from(modStore)
      .where(and(eq(modStore.namespace, this.namespace), eq(modStore.key, key)))
      .all();
    return rows.length > 0;
  }
}
```

- [ ] **Step 5: Update context.ts to use new ModStoreImpl**

In `apps/anima-mod/src/core/context.ts`, the `ModStoreImpl` constructor no longer takes a `dbPath` parameter or needs `init()`. Update:

```ts
  const store = new ModStoreImpl(modId);
  // Remove: await store.init();
```

- [ ] **Step 6: Run existing registry and store tests**

Run: `cd apps/anima-mod && bun test`
Expected: PASS — existing tests should still pass (may need to update store tests to use in-memory Drizzle DB)

- [ ] **Step 7: Commit**

```bash
git add apps/anima-mod/src/core/registry.ts apps/anima-mod/src/core/context.ts apps/anima-mod/src/core/store.ts
git commit -m "refactor(anima-mod): add per-mod lifecycle, DB-sourced config, shared Drizzle store"
```

---

## Task 6: WebSocket Event Broadcaster

**Files:**
- Create: `apps/anima-mod/src/management/ws.ts`

- [ ] **Step 1: Create WebSocket broadcaster**

Create `apps/anima-mod/src/management/ws.ts`:

```ts
import { Elysia } from "elysia";

export type ModEvent =
  | { type: "mod:status"; modId: string; status: string; error?: string }
  | { type: "mod:message"; modId: string; count: number };

const subscribers = new Set<(event: ModEvent) => void>();

export function broadcastModEvent(event: ModEvent): void {
  for (const sub of subscribers) {
    try {
      sub(event);
    } catch {
      // ignore failed subscribers
    }
  }
}

export function createWsRouter(): Elysia {
  return new Elysia().ws("/api/events", {
    open(ws) {
      const handler = (event: ModEvent) => {
        ws.send(JSON.stringify(event));
      };
      subscribers.add(handler);
      (ws as any).__modHandler = handler;
    },
    close(ws) {
      const handler = (ws as any).__modHandler;
      if (handler) subscribers.delete(handler);
    },
    message() {
      // Client doesn't send messages — this is a push-only channel
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/anima-mod/src/management/ws.ts
git commit -m "feat(anima-mod): add WebSocket event broadcaster for real-time mod status"
```

---

## Task 7: Management API Router

**Files:**
- Create: `apps/anima-mod/src/management/router.ts`
- Test: `apps/anima-mod/tests/management/router.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/anima-mod/tests/management/router.test.ts`:

```ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Elysia } from "elysia";
import { treaty } from "@elysiajs/eden";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../src/db/schema.js";
import { createManagementRouter } from "../../src/management/router.js";
import { ConfigService } from "../../src/management/config-service.js";
import { StateService } from "../../src/management/state-service.js";
import { EventService } from "../../src/management/event-service.js";
import type { Mod, ModConfigSchema } from "../../src/core/types.js";

const CREATE_TABLES = `
  CREATE TABLE mod_config (mod_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, is_secret INTEGER DEFAULT 0, updated_at TEXT, PRIMARY KEY (mod_id, key));
  CREATE TABLE mod_state (mod_id TEXT PRIMARY KEY, enabled INTEGER DEFAULT 0, status TEXT DEFAULT 'stopped', last_error TEXT, started_at TEXT, updated_at TEXT);
  CREATE TABLE mod_events (id INTEGER PRIMARY KEY AUTOINCREMENT, mod_id TEXT NOT NULL, event_type TEXT NOT NULL, detail TEXT, created_at TEXT);
`;

const testSchema: ModConfigSchema = {
  token: { type: "secret", label: "Token", required: true },
  mode: { type: "enum", label: "Mode", options: ["polling", "webhook"], default: "polling" },
};

const fakeMod: Mod = {
  id: "test-mod",
  version: "1.0.0",
  configSchema: testSchema,
  setupGuide: [
    { step: 1, title: "Setup", field: "token" },
  ],
  async init() {},
  async start() {},
  async stop() {},
};

describe("Management API", () => {
  let sqlite: Database;
  let app: Elysia;
  let client: ReturnType<typeof treaty>;

  beforeAll(async () => {
    sqlite = new Database(":memory:");
    sqlite.exec(CREATE_TABLES);
    const db = drizzle(sqlite, { schema });

    const configService = new ConfigService(db);
    const stateService = new StateService(db);
    const eventService = new EventService(db);

    // Seed state
    await stateService.setState("test-mod", { enabled: true, status: "running" });

    const modsMap = new Map([
      ["test-mod", {
        config: { id: "test-mod", path: "./mods/test", config: {} },
        mod: fakeMod,
      }],
    ]);

    const router = createManagementRouter({
      mods: modsMap as any,
      configService,
      stateService,
      eventService,
    });

    app = new Elysia().use(router);
    client = treaty(app);
  });

  afterAll(() => sqlite.close());

  test("GET /api/mods lists all mods", async () => {
    const { data } = await client.api.mods.get();
    expect(data).toHaveLength(1);
    expect(data![0].id).toBe("test-mod");
    expect(data![0].hasConfigSchema).toBe(true);
    expect(data![0].hasSetupGuide).toBe(true);
  });

  test("GET /api/mods/:id returns full detail", async () => {
    const { data } = await client.api.mods({ id: "test-mod" }).get();
    expect(data!.id).toBe("test-mod");
    expect(data!.configSchema).toBeDefined();
    expect(data!.setupGuide).toHaveLength(1);
  });

  test("PUT /api/mods/:id/config updates config", async () => {
    const { data, error } = await client.api.mods({ id: "test-mod" }).config.put({
      token: "new-token",
      mode: "polling",
    });
    expect(error).toBeNull();
  });

  test("GET /api/mods/:id/health returns status", async () => {
    const { data } = await client.api.mods({ id: "test-mod" }).health.get();
    expect(data!.status).toBe("running");
  });
});
```

- [ ] **Step 2: Install Eden Treaty**

```bash
cd apps/anima-mod && bun add @elysiajs/eden
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/anima-mod && bun test tests/management/router.test.ts`
Expected: FAIL — cannot resolve `../../src/management/router.js`

- [ ] **Step 4: Implement management router**

Create `apps/anima-mod/src/management/router.ts`:

```ts
import { Elysia, t } from "elysia";
import type { ConfigService } from "./config-service.js";
import type { StateService } from "./state-service.js";
import type { EventService } from "./event-service.js";
import type { Mod, ModConfig } from "../core/types.js";
import { broadcastModEvent } from "./ws.js";

interface LoadedMod {
  config: ModConfig;
  mod?: Mod;
  ctx?: any;
  router?: any;
}

interface ManagementDeps {
  mods: Map<string, LoadedMod>;
  configService: ConfigService;
  stateService: StateService;
  eventService: EventService;
  onRestart?: (id: string) => Promise<void>;
  onEnable?: (id: string) => Promise<void>;
  onDisable?: (id: string) => Promise<void>;
}

export function createManagementRouter(deps: ManagementDeps): Elysia {
  const { mods, configService, stateService, eventService } = deps;

  return new Elysia()
    // List all mods
    .get("/api/mods", async () => {
      const result = [];
      for (const [id, loaded] of mods) {
        const state = await stateService.getState(id);
        result.push({
          id,
          version: loaded.mod?.version ?? "unknown",
          status: state?.status ?? "stopped",
          enabled: state?.enabled ?? false,
          hasConfigSchema: !!loaded.mod?.configSchema,
          hasSetupGuide: !!(loaded.mod?.setupGuide && loaded.mod.setupGuide.length > 0),
        });
      }
      return result;
    })

    // Get mod detail
    .get("/api/mods/:id", async ({ params }) => {
      const loaded = mods.get(params.id);
      if (!loaded?.mod) throw new Error(`Module ${params.id} not found`);

      const state = await stateService.getState(params.id);
      const config = await configService.getConfig(params.id, { maskSecrets: true });

      return {
        id: params.id,
        version: loaded.mod.version,
        status: state?.status ?? "stopped",
        enabled: state?.enabled ?? false,
        configSchema: loaded.mod.configSchema ?? null,
        setupGuide: loaded.mod.setupGuide ?? null,
        config,
        health: {
          status: state?.status ?? "stopped",
          uptime: state?.startedAt ?? null,
          lastError: state?.lastError ?? null,
        },
      };
    })

    // Enable mod
    .post("/api/mods/:id/enable", async ({ params }) => {
      if (!mods.has(params.id)) throw new Error(`Module ${params.id} not found`);
      if (deps.onEnable) await deps.onEnable(params.id);
      broadcastModEvent({ type: "mod:status", modId: params.id, status: "running" });
      return { status: "enabled" };
    })

    // Disable mod
    .post("/api/mods/:id/disable", async ({ params }) => {
      if (!mods.has(params.id)) throw new Error(`Module ${params.id} not found`);
      if (deps.onDisable) await deps.onDisable(params.id);
      broadcastModEvent({ type: "mod:status", modId: params.id, status: "stopped" });
      return { status: "disabled" };
    })

    // Restart mod
    .post("/api/mods/:id/restart", async ({ params }) => {
      if (!mods.has(params.id)) throw new Error(`Module ${params.id} not found`);
      if (deps.onRestart) await deps.onRestart(params.id);
      broadcastModEvent({ type: "mod:status", modId: params.id, status: "running" });
      return { status: "restarted" };
    })

    // Update config
    .put("/api/mods/:id/config", async ({ params, body }) => {
      const loaded = mods.get(params.id);
      if (!loaded?.mod) throw new Error(`Module ${params.id} not found`);

      await configService.setConfig(
        params.id,
        body as Record<string, unknown>,
        loaded.mod.configSchema
      );
      await eventService.logEvent(params.id, "config_changed", body as Record<string, unknown>);

      // Restart if running
      const state = await stateService.getState(params.id);
      if (state?.status === "running" && deps.onRestart) {
        await deps.onRestart(params.id);
        broadcastModEvent({ type: "mod:status", modId: params.id, status: "running" });
      }

      return { status: "updated" };
    })

    // Health check
    .get("/api/mods/:id/health", async ({ params }) => {
      const state = await stateService.getState(params.id);
      return {
        status: state?.status ?? "stopped",
        uptime: state?.startedAt ?? null,
        lastError: state?.lastError ?? null,
      };
    });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/anima-mod && bun test tests/management/router.test.ts`
Expected: PASS — all 4 tests pass

- [ ] **Step 6: Commit**

```bash
git add apps/anima-mod/src/management/router.ts apps/anima-mod/tests/management/router.test.ts apps/anima-mod/package.json apps/anima-mod/bun.lock
git commit -m "feat(anima-mod): add management API router for mod CRUD and lifecycle"
```

---

## Task 8: Wire Management Layer into Server

**Files:**
- Modify: `apps/anima-mod/src/server.ts`
- Modify: `apps/anima-mod/src/index.ts`

- [ ] **Step 1: Update server.ts to mount management router + WS**

Replace `apps/anima-mod/src/server.ts` with:

```ts
import { Elysia } from "elysia";
import { ModRegistry } from "./core/registry.js";
import { createLogger } from "./core/logger.js";
import { createManagementRouter } from "./management/router.js";
import { createWsRouter } from "./management/ws.js";

const logger = createLogger("server");

export interface ServerOptions {
  port: number;
  hostname: string;
}

export async function createServer(opts: ServerOptions): Promise<Elysia> {
  const app = new Elysia();

  // Health check
  app.get("/", () => ({
    name: "anima-mod",
    version: "0.1.0",
    status: "running",
  }));

  app.get("/health", () => ({
    status: "healthy",
    service: "anima-mod",
    timestamp: new Date().toISOString(),
  }));

  // Load and register modules
  const registry = new ModRegistry();
  registry.initServices();

  logger.info("Loading modules...");
  await registry.loadFromConfig();

  // Migrate YAML config to DB on first boot
  await registry.migrateYamlConfig();

  logger.info("Initializing modules...");
  await registry.initAll();

  // Mount management API
  const managementRouter = createManagementRouter({
    mods: registry.getAll(),
    configService: registry.getConfigService()!,
    stateService: registry.getStateService()!,
    eventService: registry.getEventService()!,
    onRestart: (id) => registry.restartMod(id),
    onEnable: (id) => registry.initMod(id).then(() => registry.startMod(id)),
    onDisable: (id) => registry.stopMod(id),
  });
  app.use(managementRouter);

  // Mount WebSocket events
  app.use(createWsRouter());

  // Mount module routes
  const modServer = registry.getServer();
  app.use(modServer);

  // Start modules after server is ready
  logger.info("Starting modules...");
  await registry.startAll();

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
    await registry.stopAll();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return app;
}

// Export the App type for Eden Treaty
export type App = Awaited<ReturnType<typeof createServer>>;
```

- [ ] **Step 2: Update index.ts to export App type**

Add to end of `apps/anima-mod/src/index.ts`:

```ts
export type { App } from "./server.js";
```

- [ ] **Step 3: Run full test suite**

Run: `cd apps/anima-mod && bun test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/anima-mod/src/server.ts apps/anima-mod/src/index.ts
git commit -m "feat(anima-mod): wire management API, WebSocket, and App type export into server"
```

---

## Task 9: Update Mods with configSchema + setupGuide

**Files:**
- Modify: `apps/anima-mod/mods/telegram/mod.ts`
- Modify: `apps/anima-mod/mods/discord/mod.ts`
- Modify: `apps/anima-mod/mods/echo/mod.ts`

- [ ] **Step 1: Add configSchema and setupGuide to Telegram mod**

In `apps/anima-mod/mods/telegram/mod.ts`, add after the `version: "1.0.0",` line:

```ts
  configSchema: {
    token:         { type: "secret",  label: "Bot Token", required: true, description: "Token from @BotFather" },
    mode:          { type: "enum",    label: "Connection Mode", options: ["polling", "webhook"], default: "polling" },
    webhookUrl:    { type: "string",  label: "Webhook URL", showWhen: { mode: "webhook" } },
    webhookSecret: { type: "secret",  label: "Webhook Secret", showWhen: { mode: "webhook" } },
    linkSecret:    { type: "secret",  label: "Link Secret", description: "Optional secret for /link command" },
  },

  setupGuide: [
    { step: 1, title: "Create Bot",       instructions: "Open Telegram, search @BotFather, send /newbot, follow the prompts to create your bot." },
    { step: 2, title: "Paste Token",      field: "token" },
    { step: 3, title: "Connection Mode",  field: "mode" },
    { step: 4, title: "Verify",           action: "healthcheck" },
  ],
```

- [ ] **Step 2: Add configSchema to Discord mod**

In `apps/anima-mod/mods/discord/mod.ts`, add after `version: "1.0.0",`:

```ts
  configSchema: {
    token:   { type: "secret",  label: "Bot Token", required: true, description: "Token from Discord Developer Portal" },
    intents: { type: "number",  label: "Gateway Intents", default: 51351, description: "Bitfield for gateway intents" },
  },

  setupGuide: [
    { step: 1, title: "Create App",    instructions: "Go to discord.com/developers, create a new application, go to Bot tab, copy the token." },
    { step: 2, title: "Paste Token",   field: "token" },
    { step: 3, title: "Verify",        action: "healthcheck" },
  ],
```

- [ ] **Step 3: Add minimal configSchema to Echo mod**

In `apps/anima-mod/mods/echo/mod.ts`, add after `version: "1.0.0",`:

```ts
  configSchema: {
    prefix: { type: "string", label: "Echo Prefix", default: "echo:", description: "Prefix prepended to echoed messages" },
  },
```

- [ ] **Step 4: Run tests**

Run: `cd apps/anima-mod && bun test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/anima-mod/mods/telegram/mod.ts apps/anima-mod/mods/discord/mod.ts apps/anima-mod/mods/echo/mod.ts
git commit -m "feat(anima-mod): add configSchema and setupGuide to telegram, discord, echo mods"
```

---

## Task 10: Install / Uninstall from GitHub

**Files:**
- Create: `apps/anima-mod/src/management/installer.ts`
- Modify: `apps/anima-mod/src/management/router.ts`
- Modify: `apps/anima-mod/src/core/config.ts`

- [ ] **Step 1: Create installer service**

Create `apps/anima-mod/src/management/installer.ts`:

```ts
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { parse, stringify } from "yaml";
import { createLogger } from "../core/logger.js";
import type { Mod } from "../core/types.js";

const logger = createLogger("installer");
const USER_MODS_DIR = "./user-mods";

export interface InstallResult {
  id: string;
  version: string;
  path: string;
}

/**
 * Parse a source string like "github:user/repo" or "github:user/repo#tag"
 */
function parseSource(source: string): { owner: string; repo: string; ref?: string } {
  const match = source.match(/^github:([^/]+)\/([^#]+)(?:#(.+))?$/);
  if (!match) throw new Error(`Invalid source format: ${source}. Expected: github:user/repo`);
  return { owner: match[1], repo: match[2], ref: match[3] };
}

/**
 * Install a mod from a GitHub repository
 */
export async function installMod(source: string): Promise<InstallResult> {
  const { owner, repo, ref } = parseSource(source);
  const targetDir = resolve(USER_MODS_DIR, repo);

  if (existsSync(targetDir)) {
    throw new Error(`Module directory already exists: ${targetDir}`);
  }

  mkdirSync(USER_MODS_DIR, { recursive: true });

  // Clone the repository
  const cloneUrl = `https://github.com/${owner}/${repo}.git`;
  const args = ["git", "clone", "--depth", "1"];
  if (ref) args.push("--branch", ref);
  args.push(cloneUrl, targetDir);

  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    rmSync(targetDir, { recursive: true, force: true });
    throw new Error(`Git clone failed: ${stderr}`);
  }

  // Validate mod contract
  const modFile = join(targetDir, "mod.ts");
  if (!existsSync(modFile)) {
    rmSync(targetDir, { recursive: true, force: true });
    throw new Error(`Invalid mod: no mod.ts found in ${repo}`);
  }

  // Dynamic import to validate
  let mod: Mod;
  try {
    const modUrl = pathToFileURL(modFile).href;
    const modModule = await import(modUrl);
    mod = modModule.default ?? modModule.mod;
    if (!mod || typeof mod.init !== "function") {
      throw new Error("Does not export a valid Mod");
    }
  } catch (err) {
    rmSync(targetDir, { recursive: true, force: true });
    throw new Error(`Invalid mod: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Add to anima-mod.config.yaml
  await addToConfig(mod.id, `./user-mods/${repo}`);

  logger.info(`Installed mod '${mod.id}' from ${source}`, { version: mod.version });

  return { id: mod.id, version: mod.version, path: targetDir };
}

/**
 * Uninstall a mod by ID
 */
export async function uninstallMod(modId: string, modPath: string): Promise<void> {
  const resolvedPath = resolve(modPath);

  // Only allow uninstalling from user-mods/
  if (!resolvedPath.includes("user-mods")) {
    throw new Error("Cannot uninstall built-in mods");
  }

  // Remove directory
  if (existsSync(resolvedPath)) {
    rmSync(resolvedPath, { recursive: true, force: true });
  }

  // Remove from config
  await removeFromConfig(modId);

  logger.info(`Uninstalled mod '${modId}'`);
}

async function addToConfig(modId: string, modPath: string): Promise<void> {
  const configPath = "./anima-mod.config.yaml";
  const content = await readFile(configPath, "utf-8");
  const config = parse(content);

  if (!config.modules) config.modules = [];

  // Check for duplicate
  if (config.modules.some((m: any) => m.id === modId)) {
    throw new Error(`Module '${modId}' already exists in config`);
  }

  config.modules.push({ id: modId, path: modPath, config: {} });
  await writeFile(configPath, stringify(config));
}

async function removeFromConfig(modId: string): Promise<void> {
  const configPath = "./anima-mod.config.yaml";
  const content = await readFile(configPath, "utf-8");
  const config = parse(content);

  if (config.modules) {
    config.modules = config.modules.filter((m: any) => m.id !== modId);
    await writeFile(configPath, stringify(config));
  }
}
```

- [ ] **Step 2: Add install/uninstall endpoints to management router**

In `apps/anima-mod/src/management/router.ts`, add import:
```ts
import { installMod, uninstallMod } from "./installer.js";
```

Add endpoints to the router chain (before the final semicolon):

```ts
    // Install mod from GitHub
    .post("/api/mods/install", async ({ body }) => {
      const { source } = body as { source: string };
      if (!source) throw new Error("Missing 'source' field");
      const result = await installMod(source);
      return result;
    })

    // Uninstall mod
    .post("/api/mods/:id/uninstall", async ({ params }) => {
      const loaded = mods.get(params.id);
      if (!loaded) throw new Error(`Module ${params.id} not found`);

      // Stop if running
      if (deps.onDisable) {
        try { await deps.onDisable(params.id); } catch { /* may not be running */ }
      }

      await uninstallMod(params.id, loaded.config.path);
      mods.delete(params.id);

      return { status: "uninstalled" };
    })
```

- [ ] **Step 3: Clear config cache after install/uninstall**

In `apps/anima-mod/src/core/config.ts`, the `clearConfigCache()` function already exists. Call it in the installer after modifying the YAML:

Add to end of `addToConfig()` and `removeFromConfig()`:
```ts
import { clearConfigCache } from "../core/config.js";
// ... inside each function, after writeFile:
clearConfigCache();
```

- [ ] **Step 4: Run tests**

Run: `cd apps/anima-mod && bun test`
Expected: All existing tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/anima-mod/src/management/installer.ts apps/anima-mod/src/management/router.ts
git commit -m "feat(anima-mod): add GitHub-based mod install and uninstall"
```

---

## Task 11: Eden Treaty Client Package

**Files:**
- Create: `packages/mod-client/package.json`
- Create: `packages/mod-client/src/index.ts`
- Create: `packages/mod-client/tsconfig.json`

- [ ] **Step 1: Create package.json**

Create `packages/mod-client/package.json`:

```json
{
  "name": "@anima/mod-client",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "dependencies": {
    "@elysiajs/eden": "^1.2.0"
  },
  "peerDependencies": {
    "elysia": "^1.2.0"
  }
}
```

- [ ] **Step 2: Create client factory**

Create `packages/mod-client/src/index.ts`:

```ts
import { treaty } from "@elysiajs/eden";
import type { App } from "anima-mod";

export function createModClient(baseUrl: string) {
  return treaty<App>(baseUrl);
}

export type ModClient = ReturnType<typeof createModClient>;
```

- [ ] **Step 3: Create tsconfig.json**

Create `packages/mod-client/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Add workspace dependency to desktop**

```bash
cd apps/desktop && bun add @anima/mod-client@workspace:*
```

- [ ] **Step 5: Add workspace reference in root package.json**

Check that `packages/mod-client` is in the root `package.json` workspaces array. If workspaces uses a glob like `packages/*`, no change needed.

- [ ] **Step 6: Commit**

```bash
git add packages/mod-client/
git commit -m "feat: add @anima/mod-client Eden Treaty client package"
```

---

## Task 12: Desktop Mod Client + Hooks

**Files:**
- Create: `apps/desktop/src/lib/mod-client.ts`

- [ ] **Step 1: Create mod client instance and React hooks**

Create `apps/desktop/src/lib/mod-client.ts`:

```tsx
import { createModClient, type ModClient } from "@anima/mod-client";
import { useState, useEffect, useCallback, useRef } from "react";

const MOD_URL_KEY = "anima-mod-url";
const DEFAULT_MOD_URL = "http://localhost:3034";

export function getModUrl(): string {
  try {
    return localStorage.getItem(MOD_URL_KEY) || DEFAULT_MOD_URL;
  } catch {
    return DEFAULT_MOD_URL;
  }
}

export function setModUrl(url: string): void {
  localStorage.setItem(MOD_URL_KEY, url);
}

let clientInstance: ModClient | null = null;

export function getModClient(): ModClient {
  if (!clientInstance) {
    clientInstance = createModClient(getModUrl());
  }
  return clientInstance;
}

/** Reset client (call after URL change) */
export function resetModClient(): void {
  clientInstance = null;
}

/** Hook: fetch all mods */
export function useMods() {
  const [mods, setMods] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = getModClient();
      const { data, error: err } = await client.api.mods.get();
      if (err) throw new Error(String(err));
      setMods(data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect to anima-mod");
      setMods([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { mods, loading, error, refresh };
}

/** Hook: fetch single mod detail */
export function useModDetail(modId: string) {
  const [mod, setMod] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = getModClient();
      const { data, error: err } = await client.api.mods({ id: modId }).get();
      if (err) throw new Error(String(err));
      setMod(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch mod");
    } finally {
      setLoading(false);
    }
  }, [modId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { mod, loading, error, refresh };
}

/** Hook: WebSocket events from anima-mod */
export function useModEvents(onEvent: (event: any) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const callbackRef = useRef(onEvent);
  callbackRef.current = onEvent;

  useEffect(() => {
    const url = getModUrl().replace(/^http/, "ws") + "/api/events";
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        callbackRef.current(event);
      } catch { /* ignore parse errors */ }
    };

    ws.onerror = () => { /* silent — caller can refresh on reconnect */ };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, []);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/lib/mod-client.ts
git commit -m "feat(desktop): add mod client hooks for anima-mod management API"
```

---

## Task 13: Desktop Mods Hub Page

**Files:**
- Create: `apps/desktop/src/components/mods/StatusBadge.tsx`
- Create: `apps/desktop/src/components/mods/ModCard.tsx`
- Create: `apps/desktop/src/pages/Mods.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/components/Layout.tsx`

- [ ] **Step 1: Create StatusBadge component**

Create `apps/desktop/src/components/mods/StatusBadge.tsx`:

```tsx
const STATUS_STYLES: Record<string, string> = {
  running: "text-success",
  connected: "text-success",
  stopped: "text-text-muted/40",
  disabled: "text-text-muted/40",
  error: "text-danger",
};

export default function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.stopped;
  return (
    <span className={`font-mono text-[8px] tracking-widest uppercase ${style}`}>
      {status}
    </span>
  );
}
```

- [ ] **Step 2: Create ModCard component**

Create `apps/desktop/src/components/mods/ModCard.tsx`:

```tsx
import { useNavigate } from "react-router-dom";
import StatusBadge from "./StatusBadge";

interface ModCardProps {
  id: string;
  version: string;
  status: string;
  enabled: boolean;
  hasConfigSchema: boolean;
  onToggle: (id: string, enable: boolean) => void;
}

export default function ModCard({ id, version, status, enabled, hasConfigSchema, onToggle }: ModCardProps) {
  const navigate = useNavigate();

  return (
    <div
      onClick={() => navigate(`/mods/${id}`)}
      className={`group cursor-pointer border border-border p-4 transition-all hover:border-text-muted/30 ${
        !enabled ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-[10px] tracking-widest uppercase text-text">
          {id}
        </span>
        <StatusBadge status={status} />
      </div>

      <div className="flex items-center justify-between mt-3">
        <span className="font-mono text-[8px] text-text-muted/40">v{version}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle(id, !enabled);
          }}
          className={`w-7 h-4 rounded-full transition-colors relative ${
            enabled ? "bg-primary/30" : "bg-bg-input"
          }`}
        >
          <div
            className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${
              enabled ? "left-3.5 bg-primary" : "left-0.5 bg-text-muted/30"
            }`}
          />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create Mods hub page**

Create `apps/desktop/src/pages/Mods.tsx`:

```tsx
import { useMods, useModEvents, getModClient } from "../lib/mod-client";
import ModCard from "../components/mods/ModCard";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Mods() {
  const { mods, loading, error, refresh } = useMods();
  const [showInstall, setShowInstall] = useState(false);
  const [installSource, setInstallSource] = useState("");
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const navigate = useNavigate();

  // Real-time status updates
  useModEvents(useCallback(() => {
    refresh();
  }, [refresh]));

  const handleToggle = async (id: string, enable: boolean) => {
    const client = getModClient();
    if (enable) {
      await client.api.mods({ id }).enable.post();
    } else {
      await client.api.mods({ id }).disable.post();
    }
    refresh();
  };

  const handleInstall = async () => {
    if (!installSource.trim()) return;
    setInstalling(true);
    setInstallError(null);
    try {
      const client = getModClient();
      const { data, error: err } = await client.api.mods.install.post({ source: installSource.trim() });
      if (err) throw new Error(String(err));
      setShowInstall(false);
      setInstallSource("");
      refresh();
      if (data?.id) navigate(`/mods/${data.id}`);
    } catch (e) {
      setInstallError(e instanceof Error ? e.message : "Install failed");
    } finally {
      setInstalling(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="font-mono text-[10px] text-text-muted/40 tracking-widest">
          LOADING MODULES...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <span className="font-mono text-[10px] text-danger tracking-wider">
          ANIMA-MOD NOT RUNNING
        </span>
        <span className="font-mono text-[8px] text-text-muted/40">
          {error}
        </span>
        <button
          onClick={refresh}
          className="font-mono text-[9px] text-primary border border-primary/30 px-3 py-1 hover:bg-primary/10 transition-colors"
        >
          RETRY
        </button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="font-mono text-[11px] tracking-widest text-text-muted/60 mb-6">
          MODULES
        </h1>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {mods.map((mod) => (
            <ModCard
              key={mod.id}
              id={mod.id}
              version={mod.version}
              status={mod.status}
              enabled={mod.enabled}
              hasConfigSchema={mod.hasConfigSchema}
              onToggle={handleToggle}
            />
          ))}

          {/* Add Module card */}
          <button
            onClick={() => setShowInstall(true)}
            className="border border-dashed border-border p-4 flex items-center justify-center text-text-muted/30 hover:text-text-muted/60 hover:border-text-muted/30 transition-colors min-h-[88px]"
          >
            <span className="font-mono text-[10px] tracking-wider">+ ADD MODULE</span>
          </button>
        </div>

        {/* Install modal */}
        {showInstall && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowInstall(false)}>
            <div className="bg-bg-card border border-border p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
              <h2 className="font-mono text-[10px] tracking-widest text-text-muted/60 mb-4">INSTALL MODULE</h2>
              <input
                type="text"
                placeholder="github:user/repo"
                value={installSource}
                onChange={(e) => setInstallSource(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleInstall()}
                className="w-full bg-bg-input border border-border px-3 py-2 font-mono text-[10px] text-text focus:border-primary/50 outline-none mb-3"
                autoFocus
              />
              <p className="font-mono text-[8px] text-text-muted/30 mb-4">
                Install a module from a GitHub repository. Example: github:username/anima-mod-example
              </p>
              {installError && (
                <p className="font-mono text-[8px] text-danger mb-3">{installError}</p>
              )}
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowInstall(false)}
                  className="font-mono text-[9px] text-text-muted/40 px-3 py-1 hover:text-text transition-colors"
                >
                  CANCEL
                </button>
                <button
                  onClick={handleInstall}
                  disabled={installing || !installSource.trim()}
                  className="font-mono text-[9px] text-primary border border-primary/30 px-3 py-1 hover:bg-primary/10 transition-colors disabled:opacity-40"
                >
                  {installing ? "INSTALLING..." : "INSTALL"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add routes to App.tsx**

In `apps/desktop/src/App.tsx`, add imports:

```ts
import Mods from "./pages/Mods";
import ModDetail from "./pages/ModDetail";
```

Add routes inside the `<Routes>` block, before the catch-all:

```tsx
<Route path="/mods" element={withLayout(<Mods />)} />
<Route path="/mods/:id" element={withLayout(<ModDetail />)} />
```

- [ ] **Step 5: Add MODS nav item to Layout dock**

In `apps/desktop/src/components/Layout.tsx`, add to `STATIC_NAV_ITEMS` array (after MIND, before CFG):

```ts
{ to: "/mods", label: "MODS", icon: "\u2726" },
```

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/components/mods/ apps/desktop/src/pages/Mods.tsx apps/desktop/src/App.tsx apps/desktop/src/components/Layout.tsx
git commit -m "feat(desktop): add Mods hub page with card grid and real-time status"
```

---

## Task 14: Desktop Mod Detail Page (Wizard + Settings)

**Files:**
- Create: `apps/desktop/src/components/mods/ConfigForm.tsx`
- Create: `apps/desktop/src/components/mods/SetupWizard.tsx`
- Create: `apps/desktop/src/pages/ModDetail.tsx`

- [ ] **Step 1: Create ConfigForm (schema-driven form renderer)**

Create `apps/desktop/src/components/mods/ConfigForm.tsx`:

```tsx
import { useState } from "react";
import type { ModConfigSchema } from "./types";

interface ConfigFormProps {
  schema: ModConfigSchema;
  values: Record<string, unknown>;
  onSave: (values: Record<string, unknown>) => Promise<void>;
}

function shouldShow(field: { showWhen?: Record<string, unknown> }, values: Record<string, unknown>): boolean {
  if (!field.showWhen) return true;
  return Object.entries(field.showWhen).every(([k, v]) => values[k] === v);
}

export default function ConfigForm({ schema, values: initialValues, onSave }: ConfigFormProps) {
  const [values, setValues] = useState<Record<string, unknown>>(initialValues);
  const [saving, setSaving] = useState(false);

  const set = (key: string, val: unknown) => setValues((prev) => ({ ...prev, [key]: val }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(values);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {Object.entries(schema).map(([key, field]) => {
        if (!shouldShow(field, values)) return null;

        return (
          <div key={key}>
            <label className="block font-mono text-[9px] tracking-wider text-text-muted/60 mb-1">
              {field.label}
              {field.required && <span className="text-danger ml-1">*</span>}
            </label>

            {field.description && (
              <p className="font-mono text-[8px] text-text-muted/30 mb-1">{field.description}</p>
            )}

            {field.type === "boolean" ? (
              <button
                onClick={() => set(key, !values[key])}
                className={`w-7 h-4 rounded-full transition-colors relative ${
                  values[key] ? "bg-primary/30" : "bg-bg-input"
                }`}
              >
                <div
                  className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${
                    values[key] ? "left-3.5 bg-primary" : "left-0.5 bg-text-muted/30"
                  }`}
                />
              </button>
            ) : field.type === "enum" ? (
              <div className="flex gap-1">
                {field.options?.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => set(key, opt)}
                    className={`font-mono text-[9px] px-2 py-1 border transition-colors ${
                      values[key] === opt
                        ? "border-primary text-primary"
                        : "border-border text-text-muted/40 hover:text-text"
                    }`}
                  >
                    {opt.toUpperCase()}
                  </button>
                ))}
              </div>
            ) : field.type === "secret" ? (
              <input
                type="password"
                value={values[key] === "***" ? "" : String(values[key] ?? "")}
                placeholder={values[key] === "***" ? "saved" : ""}
                onChange={(e) => set(key, e.target.value)}
                className="w-full bg-bg-input border border-border px-2 py-1.5 font-mono text-[10px] text-text focus:border-primary/50 outline-none"
              />
            ) : field.type === "number" ? (
              <input
                type="number"
                value={String(values[key] ?? field.default ?? "")}
                onChange={(e) => set(key, Number(e.target.value))}
                className="w-full bg-bg-input border border-border px-2 py-1.5 font-mono text-[10px] text-text focus:border-primary/50 outline-none"
              />
            ) : (
              <input
                type="text"
                value={String(values[key] ?? field.default ?? "")}
                onChange={(e) => set(key, e.target.value)}
                className="w-full bg-bg-input border border-border px-2 py-1.5 font-mono text-[10px] text-text focus:border-primary/50 outline-none"
              />
            )}
          </div>
        );
      })}

      <button
        onClick={handleSave}
        disabled={saving}
        className="font-mono text-[9px] tracking-wider text-primary border border-primary/30 px-4 py-1.5 hover:bg-primary/10 transition-colors disabled:opacity-40"
      >
        {saving ? "SAVING..." : "SAVE"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create shared types file for mods components**

Create `apps/desktop/src/components/mods/types.ts`:

```ts
export type FieldType = "string" | "number" | "boolean" | "enum" | "secret";

export interface ConfigField {
  type: FieldType;
  label: string;
  required?: boolean;
  default?: unknown;
  options?: string[];
  showWhen?: Record<string, unknown>;
  description?: string;
}

export type ModConfigSchema = Record<string, ConfigField>;

export interface SetupStep {
  step: number;
  title: string;
  instructions?: string;
  field?: string;
  action?: "healthcheck";
}
```

- [ ] **Step 3: Create SetupWizard (vertical stepper)**

Create `apps/desktop/src/components/mods/SetupWizard.tsx`:

```tsx
import { useState } from "react";
import type { ModConfigSchema, SetupStep } from "./types";
import StatusBadge from "./StatusBadge";

interface SetupWizardProps {
  steps: SetupStep[];
  schema: ModConfigSchema;
  modId: string;
  onComplete: (config: Record<string, unknown>) => Promise<void>;
  onHealthCheck: () => Promise<boolean>;
}

export default function SetupWizard({ steps, schema, modId, onComplete, onHealthCheck }: SetupWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [healthStatus, setHealthStatus] = useState<"idle" | "checking" | "ok" | "fail">("idle");

  const set = (key: string, val: unknown) => setValues((prev) => ({ ...prev, [key]: val }));

  const handleNext = async () => {
    const step = steps[currentStep];

    if (step.action === "healthcheck") {
      setHealthStatus("checking");
      // Save config first, then check health
      await onComplete(values);
      const ok = await onHealthCheck();
      setHealthStatus(ok ? "ok" : "fail");
      if (!ok) return;
    }

    if (currentStep < steps.length - 1) {
      setCurrentStep((s) => s + 1);
    } else {
      await onComplete(values);
    }
  };

  return (
    <div className="space-y-0">
      {steps.map((step, i) => {
        const isDone = i < currentStep;
        const isActive = i === currentStep;
        const isPending = i > currentStep;
        const field = step.field ? schema[step.field] : null;

        return (
          <div
            key={step.step}
            className={`flex gap-3 ${isPending ? "opacity-30" : ""}`}
          >
            {/* Step indicator */}
            <div className="flex flex-col items-center">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono ${
                  isDone
                    ? "bg-success text-black"
                    : isActive
                    ? "border-2 border-primary text-primary"
                    : "border border-border text-text-muted/40"
                }`}
              >
                {isDone ? "\u2713" : step.step}
              </div>
              {i < steps.length - 1 && (
                <div className="w-px h-full min-h-[20px] bg-border/30 my-1" />
              )}
            </div>

            {/* Step content */}
            <div className={`flex-1 pb-6 ${isDone ? "opacity-50" : ""}`}>
              <div className="font-mono text-[9px] tracking-widest text-text-muted/60 uppercase mb-1">
                STEP {step.step} — {step.title}
              </div>

              {isActive && (
                <div className="mt-2 space-y-3">
                  {step.instructions && (
                    <p className="font-mono text-[10px] text-text-muted/50 leading-relaxed">
                      {step.instructions}
                    </p>
                  )}

                  {field && (
                    <div>
                      {field.type === "secret" ? (
                        <input
                          type="password"
                          placeholder={field.label}
                          value={String(values[step.field!] ?? "")}
                          onChange={(e) => set(step.field!, e.target.value)}
                          className="w-full bg-bg-input border border-border px-2 py-1.5 font-mono text-[10px] text-text focus:border-primary/50 outline-none"
                        />
                      ) : field.type === "enum" ? (
                        <div className="flex gap-1">
                          {field.options?.map((opt) => (
                            <button
                              key={opt}
                              onClick={() => set(step.field!, opt)}
                              className={`font-mono text-[9px] px-2 py-1 border transition-colors ${
                                values[step.field!] === opt
                                  ? "border-primary text-primary"
                                  : "border-border text-text-muted/40 hover:text-text"
                              }`}
                            >
                              {opt.toUpperCase()}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <input
                          type="text"
                          placeholder={field.label}
                          value={String(values[step.field!] ?? "")}
                          onChange={(e) => set(step.field!, e.target.value)}
                          className="w-full bg-bg-input border border-border px-2 py-1.5 font-mono text-[10px] text-text focus:border-primary/50 outline-none"
                        />
                      )}
                    </div>
                  )}

                  {step.action === "healthcheck" && (
                    <div className="flex items-center gap-2">
                      <StatusBadge status={
                        healthStatus === "ok" ? "running" :
                        healthStatus === "fail" ? "error" :
                        healthStatus === "checking" ? "checking" : "stopped"
                      } />
                      {healthStatus === "fail" && (
                        <span className="font-mono text-[8px] text-danger">
                          Connection failed. Check your token.
                        </span>
                      )}
                    </div>
                  )}

                  <button
                    onClick={handleNext}
                    className="font-mono text-[9px] tracking-wider text-primary border border-primary/30 px-3 py-1 hover:bg-primary/10 transition-colors"
                  >
                    {i === steps.length - 1 ? "FINISH" : "NEXT"}
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Create ModDetail page**

Create `apps/desktop/src/pages/ModDetail.tsx`:

```tsx
import { useParams, useNavigate } from "react-router-dom";
import { useModDetail, getModClient } from "../lib/mod-client";
import StatusBadge from "../components/mods/StatusBadge";
import ConfigForm from "../components/mods/ConfigForm";
import SetupWizard from "../components/mods/SetupWizard";

export default function ModDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { mod, loading, error, refresh } = useModDetail(id!);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="font-mono text-[10px] text-text-muted/40 tracking-widest">
          LOADING...
        </span>
      </div>
    );
  }

  if (error || !mod) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <span className="font-mono text-[10px] text-danger">{error || "Module not found"}</span>
        <button
          onClick={() => navigate("/mods")}
          className="font-mono text-[9px] text-text-muted/40 hover:text-text"
        >
          BACK TO MODULES
        </button>
      </div>
    );
  }

  const needsSetup = mod.setupGuide &&
    mod.setupGuide.length > 0 &&
    (!mod.config || Object.keys(mod.config).length === 0);

  const handleSaveConfig = async (values: Record<string, unknown>) => {
    const client = getModClient();
    await client.api.mods({ id: id! }).config.put(values);
    refresh();
  };

  const handleHealthCheck = async (): Promise<boolean> => {
    try {
      const client = getModClient();
      const { data } = await client.api.mods({ id: id! }).health.get();
      return data?.status === "running";
    } catch {
      return false;
    }
  };

  const handleAction = async (action: "enable" | "disable" | "restart") => {
    const client = getModClient();
    if (action === "enable") await client.api.mods({ id: id! }).enable.post();
    else if (action === "disable") await client.api.mods({ id: id! }).disable.post();
    else await client.api.mods({ id: id! }).restart.post();
    refresh();
  };

  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate("/mods")}
            className="font-mono text-[10px] text-text-muted/40 hover:text-text"
          >
            &larr;
          </button>
          <h1 className="font-mono text-[11px] tracking-widest uppercase text-text">
            {mod.id}
          </h1>
          <StatusBadge status={mod.status} />
          <span className="font-mono text-[8px] text-text-muted/30 ml-auto">
            v{mod.version}
          </span>
        </div>

        {/* Setup Wizard (first-time) */}
        {needsSetup && mod.configSchema && mod.setupGuide ? (
          <SetupWizard
            steps={mod.setupGuide}
            schema={mod.configSchema}
            modId={id!}
            onComplete={handleSaveConfig}
            onHealthCheck={handleHealthCheck}
          />
        ) : (
          <div className="space-y-6">
            {/* Status Section */}
            <div className="border border-border p-4">
              <div className="font-mono text-[9px] tracking-widest text-text-muted/60 mb-3">
                STATUS
              </div>
              <div className="flex items-center gap-4">
                <StatusBadge status={mod.status} />
                {mod.health?.uptime && (
                  <span className="font-mono text-[8px] text-text-muted/30">
                    since {new Date(mod.health.uptime).toLocaleString()}
                  </span>
                )}
              </div>
              {mod.health?.lastError && (
                <p className="font-mono text-[8px] text-danger mt-2">
                  {mod.health.lastError}
                </p>
              )}
              <div className="flex gap-2 mt-3">
                {mod.enabled ? (
                  <>
                    <button
                      onClick={() => handleAction("restart")}
                      className="font-mono text-[8px] text-text-muted/40 border border-border px-2 py-0.5 hover:text-text hover:border-text-muted/30 transition-colors"
                    >
                      RESTART
                    </button>
                    <button
                      onClick={() => handleAction("disable")}
                      className="font-mono text-[8px] text-danger/60 border border-border px-2 py-0.5 hover:text-danger hover:border-danger/30 transition-colors"
                    >
                      DISABLE
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => handleAction("enable")}
                    className="font-mono text-[8px] text-primary border border-primary/30 px-2 py-0.5 hover:bg-primary/10 transition-colors"
                  >
                    ENABLE
                  </button>
                )}
              </div>
            </div>

            {/* Config Form */}
            {mod.configSchema && (
              <div className="border border-border p-4">
                <div className="font-mono text-[9px] tracking-widest text-text-muted/60 mb-3">
                  CONFIGURATION
                </div>
                <ConfigForm
                  schema={mod.configSchema}
                  values={mod.config ?? {}}
                  onSave={handleSaveConfig}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify desktop compiles**

Run: `cd apps/desktop && bunx tsc --noEmit`
Expected: No type errors (or only pre-existing ones)

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/components/mods/ apps/desktop/src/pages/ModDetail.tsx
git commit -m "feat(desktop): add ModDetail page with setup wizard and schema-driven config form"
```

---

## Task 15: Chat Source Badge

**Files:**
- Modify: `packages/api-client/src/index.ts`
- Modify: `apps/desktop/src/pages/Chat.tsx`

- [ ] **Step 1: Add `source` to ChatMessage in api-client**

In `packages/api-client/src/index.ts`, find the `ChatMessage` interface and add:

```ts
  source?: string | null;
```

After the `traceEvents` field.

- [ ] **Step 2: Add source badge rendering in Chat.tsx**

In `apps/desktop/src/pages/Chat.tsx`, find where messages are rendered (look for the message timestamp display). After the timestamp, add a conditional source badge:

```tsx
{msg.source && (
  <span className="font-mono text-[7px] text-text-muted/25 ml-1">
    via {msg.source}
  </span>
)}
```

- [ ] **Step 3: Commit**

```bash
git add packages/api-client/src/index.ts apps/desktop/src/pages/Chat.tsx
git commit -m "feat(desktop): add 'via source' badge on chat messages from external channels"
```

---

## Task 16: Python Server — Source Column + Schema

**Files:**
- Create: `apps/server/alembic/versions/20260323_add_source_to_agent_messages.py`
- Modify: `apps/server/src/anima_server/models/agent_runtime.py`
- Modify: `apps/server/src/anima_server/schemas/chat.py`
- Modify: `apps/server/src/anima_server/services/agent/service.py`
- Modify: `apps/server/src/anima_server/api/routes/chat.py`

- [ ] **Step 1: Create Alembic migration**

The table is `agent_messages` (not `chat_messages`). Current head: `20260319_0007`.

Create `apps/server/alembic/versions/20260323_add_source_to_agent_messages.py`:

```python
"""Add source column to agent_messages

Revision ID: 20260323_source
Revises: 20260319_0007
Create Date: 2026-03-23
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "20260323_source"
down_revision: Union[str, None] = "20260319_0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("agent_messages") as batch_op:
        batch_op.add_column(sa.Column("source", sa.String(32), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("agent_messages") as batch_op:
        batch_op.drop_column("source")
```

- [ ] **Step 2: Add `source` column to AgentMessage model**

In `apps/server/src/anima_server/models/agent_runtime.py`, add to the `AgentMessage` class (after `token_estimate`):

```python
    source: Mapped[str | None] = mapped_column(String(32), nullable=True)
```

- [ ] **Step 3: Add `source` field to Python schemas**

In `apps/server/src/anima_server/schemas/chat.py`:

Add to `ChatRequest` (after `stream`):
```python
    source: str | None = None
```

Add to `ChatHistoryMessage` (after `createdAt`):
```python
    source: str | None = None
```

- [ ] **Step 4: Thread source through agent service**

In `apps/server/src/anima_server/services/agent/service.py`:

Update `run_agent()` signature at line ~110:
```python
async def run_agent(user_message: str, user_id: int, db: Session, source: str | None = None) -> AgentResult:
    return await _execute_agent_turn(user_message, user_id, db, source=source)
```

Update `stream_agent()` signature at line ~1085:
```python
async def stream_agent(user_message: str, user_id: int, db: Session, source: str | None = None) -> AsyncGenerator[AgentStreamEvent, None]:
```

Find `_execute_agent_turn()` and thread `source` through to where the user `AgentMessage` is created. Set `source=source` on the insert.

- [ ] **Step 5: Thread source through chat route**

In `apps/server/src/anima_server/api/routes/chat.py`, update the chat endpoint to pass `source=payload.source` to `run_agent()` and `stream_agent()`.

- [ ] **Step 6: Return source in history endpoint**

In `apps/server/src/anima_server/api/routes/chat.py` at line ~116, update the `ChatHistoryMessage` construction:

```python
ChatHistoryMessage(
    id=row.id,
    userId=userId,
    role="assistant" if row.role == "tool" else row.role,
    content=df(userId, row.content_text, table="agent_messages", field="content_text"),
    createdAt=row.created_at,
    source=getattr(row, "source", None),
)
```

- [ ] **Step 7: Run Python tests**

Run: `cd apps/server && python -m pytest tests/ -x -q`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add apps/server/alembic/versions/20260323_add_source_to_agent_messages.py apps/server/src/anima_server/models/agent_runtime.py apps/server/src/anima_server/schemas/chat.py apps/server/src/anima_server/services/agent/service.py apps/server/src/anima_server/api/routes/chat.py
git commit -m "feat(server): add source column to agent_messages for message origin tracking"
```

---

## Task 17: Integration Smoke Test

No new files — this is a manual verification step.

- [ ] **Step 1: Start anima-mod and verify management API**

```bash
cd apps/anima-mod && bun run dev
```

In another terminal:
```bash
curl http://localhost:3034/api/mods | jq .
```

Expected: JSON array of registered mods with their status, version, and schema flags.

- [ ] **Step 2: Verify mod detail endpoint**

```bash
curl http://localhost:3034/api/mods/echo | jq .
```

Expected: JSON object with `configSchema`, current config, and health status.

- [ ] **Step 3: Start desktop and verify Mods page**

```bash
cd apps/desktop && bun run dev
```

Navigate to `/mods`. Expected: Card grid showing registered modules with status badges and toggle switches.

- [ ] **Step 4: Run full test suites**

```bash
cd apps/anima-mod && bun test
cd apps/server && python -m pytest tests/ -x -q
```

Expected: All tests pass in both projects.

- [ ] **Step 5: Final commit (if any fixups needed)**

```bash
git add -A && git commit -m "fix: integration smoke test fixups"
```
