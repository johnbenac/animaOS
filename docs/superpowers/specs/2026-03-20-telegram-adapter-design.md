# Telegram Adapter Design

**Date:** 2026-03-20
**Status:** Approved

## Overview

Add a Telegram bot adapter to animaOS using grammY, running in the Hono gateway (`apps/api/`). The Hono server is stripped of all legacy LangChain/Drizzle code and becomes a thin bot gateway that proxies messages to the Python API (`apps/server/`).

## Architecture

```
Telegram Cloud
    │
    ▼ (webhook POST)
Hono Gateway (apps/api/, port 3033)
    │  grammY webhook adapter
    │  Thin proxy — no agent logic
    │
    ▼ (HTTP POST /api/chat)
Python API (apps/server/, port 3031)
    │  Full consciousness stack
    │  Memory, self-model, emotions, inner monologue
    │
    ▼
Response flows back through Hono → Telegram
```

## Scope

### Strip from `apps/api/`

Remove all legacy code. The Hono server becomes a bot gateway only.

| Directory/File | Reason |
|---|---|
| `src/agent/` (entire) | LangChain agent — replaced by Python server |
| `src/channels/` (entire) | Channel runtime wired to LangChain agent (old Telegram handler depends on `handleChannelMessage` from here — being replaced by grammY + Python proxy) |
| `src/db/` (entire) | Drizzle ORM + SQLite schema |
| `src/memory/` (entire) | Memory manager — in Python now |
| `src/llm/` (entire) | LLM providers — in Python now |
| `src/lib/auth-crypto.ts` | Auth crypto — in Python now |
| `src/lib/data-crypto.ts` | Data encryption — in Python now |
| `src/lib/redis.ts` | Redis/BullMQ — not used |
| `src/lib/require-unlock.ts` | Unlock middleware — not needed in gateway |
| `src/lib/task-date.ts` | Task date parsing — in Python now |
| `src/lib/unlock-session.ts` | Session management — in Python now |
| `src/lib/user-soul.ts` | Soul file ops — in Python now |
| `src/lib/vault.ts` | Vault ops — in Python now |
| `src/lib/runtime-paths.ts` | Data dir layout — not needed in gateway |
| `src/cron/` (entire) | Task reminders — in Python now |
| `src/routes/auth/` | Commented out, unused |
| `src/routes/chat/` | Commented out, unused |
| `src/routes/config/` | Commented out, unused |
| `src/routes/memory/` | Commented out, unused |
| `src/routes/soul/` | Commented out, unused |
| `src/routes/tasks/` | Commented out, unused |
| `src/routes/users/` | Commented out, unused |
| `src/routes/vault/` | Commented out, unused |
| `src/routes/channel/` | Commented out, unused |
| `src/routes/telegram/` | Old webhook handler — replaced by grammY |
| `drizzle/` | Migration files for Drizzle |
| `prompts/` | Prompt templates — in Python now |

**Keep:**
- `src/discord/gateway-relay.ts` — already a thin proxy pattern, forwards to Python API directly

**Note:** `src/routes/discord/` uses Drizzle DB imports and must also be removed. The Discord gateway relay already forwards directly to the Python API at `http://127.0.0.1:3031/api/discord/webhook`.

### Dependencies to remove from `package.json`

- `@langchain/anthropic`, `@langchain/core`, `@langchain/langgraph`, `@langchain/langgraph-checkpoint`, `@langchain/openai`, `langchain`
- `drizzle-orm`, `drizzle-kit`
- `bullmq`
- `chrono-node`
- `@noble/hashes`

### Dependencies to add

- `grammy` — Telegram bot framework

### Build what's new

#### 1. Python API Client (`src/lib/anima-api.ts`)

Thin HTTP client to call the Python API. Handles authentication.

```typescript
interface AnimaApiClient {
  login(): Promise<void>;           // POST /api/auth/login → stores unlockToken
  chat(message: string, userId: number): Promise<ChatResponse>;  // POST /api/chat
  linkTelegram(chatId: number, userId: number, linkSecret?: string): Promise<void>;
  unlinkTelegram(chatId: number): Promise<void>;
  lookupTelegram(chatId: number): Promise<number | null>;
}

interface ChatResponse {
  response: string;
  model?: string;
  provider?: string;
  toolsUsed?: string[];
}
```

On startup, calls `POST /api/auth/login` with `ANIMA_USERNAME` + `ANIMA_PASSWORD` to get an unlock token (field: `unlockToken` in response). Stores in memory. On 401 response from any call, re-authenticates automatically.

**Auth constraint:** The Python API enforces `session.user_id == payload.userId` on the chat endpoint. This means the bot can only proxy messages for the user it authenticated as. This is by design — animaOS is a personal AI. The bot authenticates as the owner and all Telegram chats link to that single user. The `TelegramLink` table exists to map chat IDs, but `user_id` will always be the authenticated user's ID.

#### 2. grammY Bot (`src/telegram/bot.ts`)

grammY bot instance with webhook mode. **Conditionally loaded** — if `TELEGRAM_BOT_TOKEN` is not set, the bot module is not initialized and the webhook route is not registered.

**Commands:**
- `/start` — Welcome message, instructions to link
- `/link <userId> [linkSecret]` — Links this Telegram chat to an animaOS user (calls Python API). Requires `TELEGRAM_LINK_SECRET` if configured, to prevent unauthorized linking.
- `/unlink` — Unlinks the chat
- Regular messages — Looked up via `lookupTelegram(chatId)`, proxied to `POST /api/chat`

**Message flow:**
1. Telegram sends webhook update to Hono
2. grammY parses the update, validates webhook secret
3. Bot looks up `chatId → userId` via Python API
4. Bot sends `sendChatAction("typing")` to show typing indicator
5. Bot calls `POST /api/chat` with `{ message, userId }`
6. Bot sends response back to Telegram chat

**Message chunking:** Telegram has a 4096-char limit. Split long responses into chunks, preserving word boundaries where possible.

**Error handling:** On Python API errors, send a user-friendly error message to the Telegram chat. Don't leak internal details.

#### 3. Hono Webhook Route (`src/index.ts`)

Replace the old telegram route with grammY's webhook callback adapter for Hono. The `webhookCallback(bot, "std/http")` returns a `(req: Request) => Promise<Response>` handler — wrap it for Hono's context:

```typescript
import { webhookCallback } from "grammy";
import { bot } from "./telegram/bot";

const handleUpdate = webhookCallback(bot, "std/http", {
  secretToken: process.env.TELEGRAM_WEBHOOK_SECRET,
});
app.post("/api/telegram/webhook", (c) => handleUpdate(c.req.raw));
```

**Conditional registration:** Only register the route if `TELEGRAM_BOT_TOKEN` is set.

#### 4. Webhook Auto-Registration (`src/telegram/setup.ts`)

On startup, if `TELEGRAM_WEBHOOK_URL` is set, calls:
```typescript
await bot.api.setWebhook(TELEGRAM_WEBHOOK_URL, {
  secret_token: TELEGRAM_WEBHOOK_SECRET,
});
```
This registers the webhook with Telegram automatically. No manual BotFather setup needed beyond creating the bot and getting the token.

### Python Side Changes

#### Model: `TelegramLink` (already exists)

The model already exists at `apps/server/src/anima_server/models/links.py` with the correct schema:
- `id` (PK), `chat_id` (BigInteger, unique), `user_id` (FK → users.id), `created_at`

The Alembic migration also already exists (`20260319_0007_create_missing_tables.py`).

#### New Routes: `api/routes/telegram.py`

```
POST   /api/telegram/link      { chatId, userId, linkSecret? }  → 201
DELETE /api/telegram/link       { chatId }                       → 200
GET    /api/telegram/link       ?chatId=...                      → { userId } | 404
```

These routes require the `x-anima-unlock` header. The link endpoint validates `TELEGRAM_LINK_SECRET` env var if configured.

**Link logic:**
- Deletes any existing link for the same `chatId` or `userId` before creating new one (one-to-one mapping)
- Returns 404 if the target `userId` doesn't exist

## Configuration

### Environment Variables

```env
# Required
TELEGRAM_BOT_TOKEN=<from BotFather>
TELEGRAM_WEBHOOK_URL=https://your-domain.com/api/telegram/webhook
PYTHON_API_BASE=http://127.0.0.1:3031/api

# Auth for bot → Python API
ANIMA_USERNAME=<animaOS username>
ANIMA_PASSWORD=<animaOS password>

# Optional
TELEGRAM_WEBHOOK_SECRET=<random string for webhook validation>
TELEGRAM_LINK_SECRET=<secret required for /link command, prevents unauthorized linking>
```

**Note on credentials:** `ANIMA_USERNAME` and `ANIMA_PASSWORD` are used by the bot process to authenticate with the local Python API. Since both services run on the same machine, this is acceptable. For hardened deployments, consider a dedicated bot service account.

### Webhook Exposure

The webhook URL must be publicly accessible via HTTPS. Options:
- Cloudflare Tunnel (`cloudflared tunnel`)
- ngrok
- Reverse proxy on a VPS
- Direct public IP with TLS

## Security Considerations

- **Webhook secret:** grammY validates `X-Telegram-Bot-Api-Secret-Token` header via `secretToken` option in `webhookCallback`
- **Link secret:** `/link` command requires `TELEGRAM_LINK_SECRET` if configured, preventing unauthorized users from linking to an animaOS account
- **Auth:** Bot authenticates with Python API using username/password, gets unlock token
- **Token refresh:** On 401 response, bot re-authenticates automatically
- **Chat isolation:** Each Telegram chat maps to exactly one animaOS user; unlinked chats get a prompt to `/link`
- **Graceful degradation:** If `TELEGRAM_BOT_TOKEN` is not set, the bot module is not loaded and the webhook route is not registered — no errors, no dangling routes

## Testing Strategy

- Unit tests for the API client (mock fetch)
- Unit tests for the bot command handlers (grammY's test utilities)
- Integration test: webhook → grammY → mock Python API → Telegram response
- Python side: tests for TelegramLink CRUD routes

## File Structure (after cleanup)

```
apps/api/
├── src/
│   ├── index.ts                    # Hono app — health, telegram webhook, discord routes
│   ├── telegram/
│   │   ├── bot.ts                  # grammY bot instance + command handlers
│   │   └── setup.ts               # Webhook auto-registration
│   ├── discord/
│   │   └── gateway-relay.ts       # Discord gateway (kept as-is)
│   ├── routes/
│   │   └── discord/               # Discord webhook route (kept)
│   └── lib/
│       └── anima-api.ts           # Python API HTTP client
├── package.json                    # Slimmed: hono + grammy + zod only
└── tsconfig.json
```
