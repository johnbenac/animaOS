# Schema-Driven Module System & Telegram Flow

**Date:** 2026-03-23
**Status:** Approved

## Summary

Add a schema-driven management layer to anima-mod and a Mods page to the desktop UI so users can configure, enable/disable, and monitor external integrations (Telegram, Discord, etc.) from the desktop app. Chat messages from all sources appear in a unified conversation with subtle source badges.

## Decisions

- **Elysia** stays as the anima-mod framework (Bun-locked, Eden Treaty type safety)
- **Desktop talks to anima-mod directly** (default `http://localhost:3034`) — Python server is pure cognitive core, does not proxy mod management
- **SQLite + Drizzle** for anima-mod's own database (config, state, events) — same portability philosophy as the cognitive core
- **Schema-driven UI** — mods declare their config schema and optional setup wizard; desktop renders forms dynamically, zero frontend changes per new mod
- **Eden Treaty** client for type-safe desktop ↔ anima-mod communication
- **Unified chat** — messages from all sources appear in one conversation, tagged with a subtle `via Telegram` badge under the timestamp

## 1. Mod Schema Contract

### Extended Mod Interface

The existing `Mod` interface gains two optional fields:

```ts
interface Mod {
  id: string;
  version: string;
  init(ctx: ModContext): Promise<void>;
  start(): Promise<void>;
  stop?(): Promise<void>;
  getRouter?(): AnyElysia;

  // NEW
  configSchema?: ModConfigSchema;
  setupGuide?: SetupStep[];
}
```

### Config Schema

Each mod can declare what configuration it accepts. The desktop renders settings forms from this schema — no per-mod frontend code needed.

```ts
type FieldType = "string" | "number" | "boolean" | "enum" | "secret";

interface ConfigField {
  type: FieldType;
  label: string;
  required?: boolean;
  default?: unknown;
  options?: string[]; // for enum type
  showWhen?: Record<string, unknown>; // conditional visibility (simple equality: { mode: "webhook" } means show when config.mode === "webhook")
  description?: string;
}

type ModConfigSchema = Record<string, ConfigField>;
```

### Setup Guide

Optional guided wizard steps. If present and the mod isn't configured yet, the desktop shows a vertical stepper wizard instead of a raw form.

```ts
interface SetupStep {
  step: number;
  title: string;
  instructions?: string; // guidance text
  field?: string; // which config field this step collects
  action?: "healthcheck"; // special step types
}
```

### Example: Telegram Mod

```ts
export default {
  id: "telegram",
  version: "1.0.0",

  configSchema: {
    token: {
      type: "secret",
      label: "Bot Token",
      required: true,
      description: "Token from @BotFather",
    },
    mode: {
      type: "enum",
      label: "Connection Mode",
      options: ["polling", "webhook"],
      default: "polling",
    },
    webhookUrl: {
      type: "string",
      label: "Webhook URL",
      showWhen: { mode: "webhook" },
    },
    webhookSecret: {
      type: "secret",
      label: "Webhook Secret",
      showWhen: { mode: "webhook" },
    },
    linkSecret: {
      type: "secret",
      label: "Link Secret",
      description: "Optional secret for /link command",
    },
  },

  setupGuide: [
    {
      step: 1,
      title: "Create Bot",
      instructions:
        "Open Telegram, search @BotFather, send /newbot, follow the prompts to create your bot.",
    },
    { step: 2, title: "Paste Token", field: "token" },
    { step: 3, title: "Connection Mode", field: "mode" },
    { step: 4, title: "Verify", action: "healthcheck" },
  ],

  // ... init, start, stop, getRouter unchanged
} satisfies Mod;
```

Mods without `configSchema` or `setupGuide` still work — they get a basic status card with no settings form. Fully backwards compatible.

## 2. Management API

anima-mod gets a management router mounted at `/api/` (separate from per-mod routes at `/{modId}/`).

### REST Endpoints

| Method | Path                    | Description                                                                      |
| ------ | ----------------------- | -------------------------------------------------------------------------------- |
| `GET`  | `/api/mods`             | List all mods: id, version, status, hasConfigSchema, hasSetupGuide               |
| `GET`  | `/api/mods/:id`         | Full detail: config schema, setup guide, current config (secrets masked), health |
| `POST` | `/api/mods/:id/enable`  | Start a stopped mod                                                              |
| `POST` | `/api/mods/:id/disable` | Stop a running mod                                                               |
| `POST` | `/api/mods/:id/restart` | Stop + start                                                                     |
| `PUT`  | `/api/mods/:id/config`  | Update config, validated against schema. Restarts mod if running                 |
| `GET`  | `/api/mods/:id/health`  | Status, uptime, last activity, error if any                                      |

### WebSocket

| Path             | Description                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| `WS /api/events` | Real-time events: `mod:status` (connected/disconnected/error), `mod:message` (message count updates) |

### Behaviors

- `GET /api/mods/:id` never returns secret field values — returns `"***"` if set, empty string if not
- `PUT /api/mods/:id/config` validates against the mod's `configSchema` before applying
- Config changes persist to the database (not YAML)
- Enable/disable calls the registry's lifecycle methods — requires refactoring `ModRegistry` to support per-mod init/start/stop (current `initAll()`/`startAll()` only support batch operations). `createModContext()` must be updated to source config from the database instead of YAML

## 3. Database (anima-mod owned)

anima-mod gets its own SQLite database managed by Drizzle ORM. Located at `./data/a-mod.db`.

### Why SQLite + Drizzle

- anima-mod runs locally, single process — SQLite's sweet spot
- Portable (one file, copy to new machine)
- Drizzle provides typed queries, migration tooling, and scales to future complexity
- `bun:sqlite` driver, zero external database dependencies

### Schema

**`mod_config`** — runtime configuration per mod (replaces YAML for runtime config):

```sql
CREATE TABLE mod_config (
  mod_id     TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,          -- JSON-encoded
  is_secret  BOOLEAN DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (mod_id, key)
);
```

**`mod_state`** — lifecycle state per mod:

```sql
CREATE TABLE mod_state (
  mod_id     TEXT PRIMARY KEY,
  enabled    BOOLEAN DEFAULT 0,
  status     TEXT DEFAULT 'stopped',  -- stopped | running | error
  last_error TEXT,
  started_at DATETIME,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**`mod_events`** — audit log:

```sql
CREATE TABLE mod_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  mod_id     TEXT NOT NULL,
  event_type TEXT NOT NULL,           -- config_changed | started | stopped | error
  detail     TEXT,                    -- JSON payload
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**`mod_store`** — (existing) module-private KV data. Migrated to Drizzle schema.

### Boot Sequence

1. anima-mod starts, reads `anima-mod.config.yaml` for module **discovery** (which mods exist, where their code lives)
2. Runtime config (tokens, modes, secrets) comes from the database
3. YAML = "what mods are installed", DB = "how they're configured"

### Migration from YAML Config

On first boot after upgrade (DB has no config entries for a mod, but YAML has `config:` values):

1. For each mod in YAML that has `config` fields and no corresponding `mod_config` DB entries: seed the DB from YAML values
2. Log a warning: "Migrated config for mod X from YAML to database"
3. After migration, YAML config values are ignored for that mod — DB is authoritative
4. This is a one-time migration. Subsequent boots skip mods that already have DB config

## 4. Desktop UI

### 4.1 Mods Hub Page (`/mods`)

New top-level page in the desktop navigation.

**Card Grid Layout:**

- Fetches `GET /api/mods` from anima-mod
- Each mod rendered as a card: name, version, status badge, enable/disable toggle
- Click a card → navigates to `/mods/:id`
- Disabled mods shown at reduced opacity
- Status badges update in real-time via WebSocket

**Connection state:**

- If anima-mod is unreachable, show a banner: "anima-mod not running" with the configured URL
- anima-mod URL configurable in Advanced Settings (default: `http://localhost:3034`)

### 4.2 Individual Mod Page (`/mods/:id`)

Fetches `GET /api/mods/:id` for schema, setup guide, current config, and health.

**First-time setup (mod has `setupGuide` and isn't configured):**

- Vertical stepper wizard
- All steps visible, completed steps collapse, current step expanded
- Each step either shows instructions, a config field (rendered from schema), or a health check action
- On completion, writes config via `PUT /api/mods/:id/config` and enables the mod

**Already configured:**

- Settings form auto-generated from `configSchema`
- Secret fields show "saved" indicator, never display values
- Live status section: connection state, uptime, last activity
- Restart / disable buttons
- Form changes saved via `PUT /api/mods/:id/config`

### 4.3 Chat Source Badge

- `ChatMessage` gains a `source` field
- Messages from external channels show subtle muted text `via Telegram` under the timestamp
- Desktop-originated messages show nothing (default source)

## 5. Eden Treaty Client

Type-safe client generated from anima-mod's Elysia routes.

### Package Structure

`packages/mod-client/` — thin wrapper exporting the treaty client factory:

```ts
import { treaty } from "@elysiajs/eden";
import type { App } from "anima-mod";

export function createModClient(baseUrl: string) {
  return treaty<App>(baseUrl);
}
```

anima-mod exports its app type from `src/index.ts`.

### Desktop Usage

```ts
import { createModClient } from "@anima/mod-client";

const mods = createModClient("http://localhost:3034");

// Fully typed — autocomplete, parameter validation, return types
const { data } = await mods.api.mods.get();
const { data } = await mods.api.mods({ id: "telegram" }).get();
await mods.api.mods({ id: "telegram" }).config.put({ token: "..." });
```

Changes to anima-mod endpoints produce TypeScript errors in the desktop at compile time. No manual type definitions to maintain.

## 6. Python Server Changes

Minimal changes — Python stays a pure cognitive core.

### Add `source` column

One Alembic migration:

```sql
ALTER TABLE chat_messages ADD COLUMN source VARCHAR(32);
```

### Extend ChatRequest schema

The Python server's `ChatRequest` Pydantic schema currently accepts `message`, `userId`, and `stream`. Add an optional `source` field (or a `context` object containing `source`). The chat service must thread this value through `run_agent()` / `stream_agent()` to message persistence.

anima-mod already sends `context: { source: "telegram" }` in its `AnimaClient.chat()` calls, but the Python server currently ignores it. This change makes the server accept and persist it.

### Persist source to chat history

When storing user messages and assistant responses, save the `source` value to the new column. Desktop-originated messages (no source provided) default to `null`.

### Return source in history

`GET /api/chat/history` includes `source` on each `ChatMessage` response so the desktop can render the badge.

## 7. Data Flow

### Message via Telegram

```
Telegram → Grammy → anima-mod telegram mod
  → ctx.anima.chat({ message, userId, context: { source: "telegram" } })
  → Python server persists with source="telegram", runs agent, responds
  → telegram mod sends response via Grammy
  → Desktop sees message with "via Telegram" badge
```

### Configure Telegram from desktop

```
Desktop → Eden Treaty → PUT /api/mods/telegram/config { token: "..." }
  → anima-mod validates against configSchema
  → Writes to Drizzle/SQLite
  → Restarts telegram mod
  → WebSocket pushes mod:status "connected"
  → Mods page card updates live
```

### New mod added (developer workflow)

```
1. Write mods/whatsapp/mod.ts with configSchema + setupGuide
2. Add entry to anima-mod.config.yaml
3. Restart anima-mod
4. Desktop Mods page automatically shows WhatsApp card
5. Click → wizard renders from setupGuide
6. Config form renders from configSchema
7. Zero frontend code changes
```

## Non-Goals (This Spec)

- anima-mod does not proxy cognitive core API calls — desktop talks to Python directly for chat, memory, etc.
- No multi-tenant support — single user, local runtime
- No hot-reload of mod code — restart required for code changes (config changes are hot)

## 8. Install / Uninstall (This Spec)

Basic GitHub-based mod installation, included in this spec as foundation for future marketplace.

### Install Flow

```
Desktop → POST /api/mods/install { source: "github:user/repo" }
  → anima-mod clones repo to user-mods/{repo-name}/
  → Validates mod contract (mod.ts exists, exports valid Mod)
  → Adds entry to anima-mod.config.yaml
  → Returns mod metadata
  → Desktop navigates to /mods/{id} for setup wizard
```

### Uninstall Flow

```
Desktop → POST /api/mods/:id/uninstall
  → Stops mod if running
  → Removes directory from user-mods/
  → Removes entry from anima-mod.config.yaml
  → Removes DB config/state entries
```

### API Endpoints

| Method | Path                      | Description                                       |
| ------ | ------------------------- | ------------------------------------------------- |
| `POST` | `/api/mods/install`       | Install mod from `{ source: "github:user/repo" }` |
| `POST` | `/api/mods/:id/uninstall` | Uninstall mod, remove files + config              |

### Desktop UI

"Add Module" button on the Mods hub page. Opens a modal with a text input for the GitHub source (e.g., `github:user/anima-mod-telegram`). Shows progress during clone + validation.

## Future: Mod Ecosystem (Follow-Up Spec)

Community-driven mod ecosystem planned as a follow-up spec, building on this foundation:

- **Distribution:** GitHub-based (not npm) — mods are GitHub repos following the mod contract. Versioning via git tags. `anima-mod install github:user/repo` clones and registers.
- **Discovery:** Start with a curated `awesome-anima-mods` GitHub list. Later, build a thin registry index `{ name, repo, description, author, verified }` — the browse UI reads from that. Actual mod code stays on GitHub (Homebrew model).
- **Trust & Sandboxing:** Mods currently run in the same Bun process — a bad mod can crash everything. Follow-up spec must address: mod permission declarations (network, filesystem, etc.), crash isolation (separate Bun workers per mod), permission prompts in desktop UI.
- **Trust Model:** Verified publishers, code signing, community ratings/download counts.

This spec provides the prerequisites: schema contract, management API, lifecycle management, database layer, and basic install/uninstall.
