# Telegram Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip legacy code from `apps/api/`, add a grammY-based Telegram bot that proxies messages to the Python API.

**Architecture:** Hono gateway (`apps/api/`) becomes a thin bot proxy. grammY handles Telegram webhooks. All agent logic stays in Python (`apps/server/`). User mapping (TelegramLink) is managed via new Python API routes.

**Tech Stack:** grammY, Hono, Bun, FastAPI, SQLAlchemy, Alembic

**Spec:** `docs/superpowers/specs/2026-03-20-telegram-adapter-design.md`

---

## File Structure

### Files to Delete (Legacy Cleanup)

```
apps/api/src/agent/                    # Entire directory (LangChain agent)
apps/api/src/channels/                 # Entire directory (channel runtime)
apps/api/src/db/                       # Entire directory (Drizzle ORM)
apps/api/src/memory/                   # Entire directory (memory manager)
apps/api/src/llm/                      # Entire directory (LLM providers)
apps/api/src/cron/                     # Entire directory (task reminders)
apps/api/src/lib/auth-crypto.ts
apps/api/src/lib/data-crypto.ts
apps/api/src/lib/redis.ts
apps/api/src/lib/require-unlock.ts
apps/api/src/lib/task-date.ts
apps/api/src/lib/unlock-session.ts
apps/api/src/lib/user-soul.ts
apps/api/src/lib/vault.ts
apps/api/src/lib/runtime-paths.ts
apps/api/src/routes/auth/              # Entire directory
apps/api/src/routes/chat/              # Entire directory
apps/api/src/routes/config/            # Entire directory
apps/api/src/routes/memory/            # Entire directory
apps/api/src/routes/soul/              # Entire directory
apps/api/src/routes/tasks/             # Entire directory
apps/api/src/routes/users/             # Entire directory
apps/api/src/routes/vault/             # Entire directory
apps/api/src/routes/channel/           # Entire directory
apps/api/src/routes/telegram/          # Entire directory (old handler)
apps/api/src/routes/discord/           # Uses Drizzle DB — must be removed
apps/api/drizzle/                      # Entire directory (migration files)
apps/api/prompts/                      # Entire directory (prompt templates)
```

### Files to Create (Hono Side)

```
apps/api/src/lib/anima-api.ts          # Python API HTTP client
apps/api/src/telegram/bot.ts           # grammY bot + command handlers
apps/api/src/telegram/setup.ts         # Webhook auto-registration
```

### Files to Modify (Hono Side)

```
apps/api/src/index.ts                  # Rewrite — slim gateway
apps/api/package.json                  # Remove legacy deps, add grammy
```

### Files to Create (Python Side)

```
apps/server/src/anima_server/api/routes/telegram.py    # Link CRUD routes
apps/server/src/anima_server/schemas/telegram.py       # Pydantic schemas
apps/server/tests/test_telegram_routes.py              # Route tests
```

### Files to Modify (Python Side)

```
apps/server/src/anima_server/main.py                   # Register telegram router
```

### Existing (no changes needed)

```
apps/server/src/anima_server/models/links.py           # TelegramLink model already exists
apps/server/alembic/versions/20260319_0007_...py       # Migration already exists
```

---

## Task 1: Python-Side Telegram Link Routes

Build the Python API endpoints that the Telegram bot will call to manage user ↔ chat mappings.

**Files:**
- Create: `apps/server/src/anima_server/schemas/telegram.py`
- Create: `apps/server/src/anima_server/api/routes/telegram.py`
- Modify: `apps/server/src/anima_server/main.py`
- Create: `apps/server/tests/test_telegram_routes.py`

- [ ] **Step 1: Write Pydantic schemas**

Create `apps/server/src/anima_server/schemas/telegram.py`:

```python
from __future__ import annotations

from pydantic import BaseModel, Field


class TelegramLinkRequest(BaseModel):
    chatId: int
    userId: int = Field(ge=0)
    linkSecret: str | None = None


class TelegramUnlinkRequest(BaseModel):
    chatId: int


class TelegramLinkResponse(BaseModel):
    chatId: int
    userId: int
```

- [ ] **Step 2: Write failing tests for link routes**

Create `apps/server/tests/test_telegram_routes.py`.

Uses the project's `managed_test_client` context manager pattern (see `conftest.py`). Each test creates its own isolated app + temp dir, registers a user, and uses the unlock token.

```python
from __future__ import annotations

import os

from conftest import managed_test_client


def _register(client):
    """Register a test user and return (user_id, headers_with_unlock_token)."""
    resp = client.post("/api/auth/register", json={
        "username": "tgtest",
        "password": "testpass123",
        "displayName": "TG Test",
    })
    assert resp.status_code == 200, resp.text
    data = resp.json()
    headers = {"x-anima-unlock": data["unlockToken"]}
    return int(data["id"]), headers


class TestTelegramLinkRoutes:
    """Tests for POST/GET/DELETE /api/telegram/link."""

    def test_link_creates_mapping(self):
        os.environ.pop("TELEGRAM_LINK_SECRET", None)
        with managed_test_client("tg-link-") as client:
            uid, headers = _register(client)
            resp = client.post("/api/telegram/link", json={
                "chatId": 99001, "userId": uid,
            }, headers=headers)
            assert resp.status_code == 201
            data = resp.json()
            assert data["chatId"] == 99001
            assert data["userId"] == uid

    def test_lookup_returns_linked_user(self):
        os.environ.pop("TELEGRAM_LINK_SECRET", None)
        with managed_test_client("tg-lookup-") as client:
            uid, headers = _register(client)
            client.post("/api/telegram/link", json={
                "chatId": 99002, "userId": uid,
            }, headers=headers)
            resp = client.get("/api/telegram/link", params={"chatId": 99002}, headers=headers)
            assert resp.status_code == 200
            assert resp.json()["userId"] == uid

    def test_lookup_returns_404_when_not_linked(self):
        with managed_test_client("tg-404-") as client:
            _, headers = _register(client)
            resp = client.get("/api/telegram/link", params={"chatId": 99999}, headers=headers)
            assert resp.status_code == 404

    def test_unlink_removes_mapping(self):
        os.environ.pop("TELEGRAM_LINK_SECRET", None)
        with managed_test_client("tg-unlink-") as client:
            uid, headers = _register(client)
            client.post("/api/telegram/link", json={
                "chatId": 99003, "userId": uid,
            }, headers=headers)
            resp = client.delete("/api/telegram/link", json={"chatId": 99003}, headers=headers)
            assert resp.status_code == 200
            resp = client.get("/api/telegram/link", params={"chatId": 99003}, headers=headers)
            assert resp.status_code == 404

    def test_link_replaces_existing_for_same_chat(self):
        os.environ.pop("TELEGRAM_LINK_SECRET", None)
        with managed_test_client("tg-replace-") as client:
            uid, headers = _register(client)
            client.post("/api/telegram/link", json={
                "chatId": 99004, "userId": uid,
            }, headers=headers)
            resp = client.post("/api/telegram/link", json={
                "chatId": 99004, "userId": uid,
            }, headers=headers)
            assert resp.status_code == 201

    def test_link_requires_secret_when_configured(self):
        os.environ["TELEGRAM_LINK_SECRET"] = "test-secret-123"
        try:
            with managed_test_client("tg-secret-req-") as client:
                uid, headers = _register(client)
                resp = client.post("/api/telegram/link", json={
                    "chatId": 99005, "userId": uid,
                }, headers=headers)
                assert resp.status_code == 403
        finally:
            os.environ.pop("TELEGRAM_LINK_SECRET", None)

    def test_link_accepts_correct_secret(self):
        os.environ["TELEGRAM_LINK_SECRET"] = "test-secret-123"
        try:
            with managed_test_client("tg-secret-ok-") as client:
                uid, headers = _register(client)
                resp = client.post("/api/telegram/link", json={
                    "chatId": 99006, "userId": uid, "linkSecret": "test-secret-123",
                }, headers=headers)
                assert resp.status_code == 201
        finally:
            os.environ.pop("TELEGRAM_LINK_SECRET", None)

    def test_link_rejects_wrong_secret(self):
        os.environ["TELEGRAM_LINK_SECRET"] = "test-secret-123"
        try:
            with managed_test_client("tg-secret-bad-") as client:
                uid, headers = _register(client)
                resp = client.post("/api/telegram/link", json={
                    "chatId": 99007, "userId": uid, "linkSecret": "wrong",
                }, headers=headers)
                assert resp.status_code == 403
        finally:
            os.environ.pop("TELEGRAM_LINK_SECRET", None)

    def test_link_requires_auth(self):
        with managed_test_client("tg-noauth-") as client:
            resp = client.post("/api/telegram/link", json={
                "chatId": 99008, "userId": 1,
            })
            assert resp.status_code == 401
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/server && python -m pytest tests/test_telegram_routes.py -v`
Expected: FAIL (routes don't exist yet)

- [ ] **Step 4: Implement the route handlers**

Create `apps/server/src/anima_server/api/routes/telegram.py`:

```python
from __future__ import annotations

import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from anima_server.api.deps.unlock import require_unlocked_session
from anima_server.db import get_db
from anima_server.models import TelegramLink, User
from anima_server.schemas.telegram import (
    TelegramLinkRequest,
    TelegramLinkResponse,
    TelegramUnlinkRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/telegram", tags=["telegram"])


@router.post("/link", response_model=TelegramLinkResponse, status_code=201)
def link_telegram(
    payload: TelegramLinkRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> TelegramLinkResponse:
    require_unlocked_session(request)

    link_secret = os.environ.get("TELEGRAM_LINK_SECRET")
    if link_secret:
        if not payload.linkSecret or payload.linkSecret != link_secret:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invalid link secret.",
            )

    user = db.get(User, payload.userId)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User {payload.userId} not found.",
        )

    # Remove existing links for this chat_id or user_id (one-to-one mapping)
    for existing in db.scalars(
        select(TelegramLink).where(
            (TelegramLink.chat_id == payload.chatId)
            | (TelegramLink.user_id == payload.userId)
        )
    ).all():
        db.delete(existing)

    link = TelegramLink(chat_id=payload.chatId, user_id=payload.userId)
    db.add(link)
    db.commit()

    return TelegramLinkResponse(chatId=payload.chatId, userId=payload.userId)


@router.get("/link", response_model=TelegramLinkResponse)
def lookup_telegram(
    request: Request,
    chatId: int = Query(),
    db: Session = Depends(get_db),
) -> TelegramLinkResponse:
    require_unlocked_session(request)

    link = db.scalar(
        select(TelegramLink).where(TelegramLink.chat_id == chatId)
    )
    if link is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No link found for this chat.",
        )
    return TelegramLinkResponse(chatId=link.chat_id, userId=link.user_id)


@router.delete("/link")
def unlink_telegram(
    payload: TelegramUnlinkRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    require_unlocked_session(request)

    link = db.scalar(
        select(TelegramLink).where(TelegramLink.chat_id == payload.chatId)
    )
    if link:
        db.delete(link)
        db.commit()

    return {"status": "unlinked"}
```

- [ ] **Step 5: Register router in main.py**

In `apps/server/src/anima_server/main.py`, add after the existing router imports:

```python
from anima_server.api.routes.telegram import router as telegram_router
```

And in the router registration block (around line 166-168), add:

```python
    app.include_router(telegram_router)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/server && python -m pytest tests/test_telegram_routes.py -v`
Expected: All 9 tests PASS

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/anima_server/schemas/telegram.py apps/server/src/anima_server/api/routes/telegram.py apps/server/src/anima_server/main.py apps/server/tests/test_telegram_routes.py
git commit -m "feat(telegram): add link/unlink/lookup routes for Telegram chat mapping"
```

---

## Task 2: Strip Legacy Code from `apps/api/`

Delete all code that's been superseded by the Python server.

**Files:**
- Delete: all directories/files listed in "Files to Delete" above
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Delete legacy directories**

```bash
cd C:/Users/leoca/OneDrive/Desktop/anima/animaOS
rm -rf apps/api/src/agent
rm -rf apps/api/src/channels
rm -rf apps/api/src/db
rm -rf apps/api/src/memory
rm -rf apps/api/src/llm
rm -rf apps/api/src/cron
rm -rf apps/api/src/routes/auth
rm -rf apps/api/src/routes/chat
rm -rf apps/api/src/routes/config
rm -rf apps/api/src/routes/memory
rm -rf apps/api/src/routes/soul
rm -rf apps/api/src/routes/tasks
rm -rf apps/api/src/routes/users
rm -rf apps/api/src/routes/vault
rm -rf apps/api/src/routes/channel
rm -rf apps/api/src/routes/telegram
rm -rf apps/api/src/routes/discord
rm -rf apps/api/drizzle
rm -rf apps/api/prompts
```

- [ ] **Step 2: Delete legacy lib files**

```bash
rm -f apps/api/src/lib/auth-crypto.ts
rm -f apps/api/src/lib/data-crypto.ts
rm -f apps/api/src/lib/redis.ts
rm -f apps/api/src/lib/require-unlock.ts
rm -f apps/api/src/lib/task-date.ts
rm -f apps/api/src/lib/unlock-session.ts
rm -f apps/api/src/lib/user-soul.ts
rm -f apps/api/src/lib/vault.ts
rm -f apps/api/src/lib/runtime-paths.ts
```

- [ ] **Step 3: Delete legacy test files**

```bash
rm -rf apps/api/src/lib/__tests__
```

- [ ] **Step 4: Update package.json**

Rewrite `apps/api/package.json` to only keep what's needed:

```json
{
  "name": "api",
  "version": "0.2.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "build": "bun build src/index.ts --outdir dist --target bun",
    "test": "bun test src"
  },
  "dependencies": {
    "grammy": "^1.35.0",
    "hono": "^4.0.0",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "@types/bun": "^1.0.0",
    "bun-types": "^1.3.10",
    "typescript": "^5.3.3"
  }
}
```

- [ ] **Step 5: Rewrite `src/index.ts` as slim gateway**

Replace `apps/api/src/index.ts` with:

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { startDiscordGatewayRelay } from "./discord/gateway-relay";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: [
      "http://localhost:1420",
      "http://localhost:5173",
      "http://tauri.localhost",
      "https://tauri.localhost",
      "tauri://localhost",
    ],
    credentials: true,
  }),
);

// Health
app.get("/", (c) => c.json({ name: "ANIMA Bot Gateway", version: "0.2.0" }));
app.get("/health", (c) => c.json({ status: "healthy", service: "bot-gateway" }));

// Telegram webhook (registered in Task 3 after bot is created)
// Discord gateway relay (connects via WebSocket, forwards to Python API)
startDiscordGatewayRelay();

export default {
  port: 3033,
  hostname: "127.0.0.1",
  fetch: app.fetch,
};

export { app };
```

- [ ] **Step 6: Install new dependencies**

```bash
cd apps/api && bun install
```

- [ ] **Step 7: Verify the gateway starts**

```bash
cd apps/api && timeout 5 bun run src/index.ts || true
```

Expected: Server starts on port 3033 without import errors. The `timeout` ensures it exits after 5 seconds.

- [ ] **Step 8: Commit**

```bash
git add -A apps/api/
git commit -m "refactor(api): strip legacy LangChain/Drizzle code, slim to bot gateway

Remove agent, channels, db, memory, llm, cron, and all deprecated routes.
Keep Discord gateway relay. Add grammy dependency for Telegram adapter."
```

---

## Task 3: Python API Client (`anima-api.ts`)

Build the HTTP client that the bot uses to talk to the Python server.

**Files:**
- Create: `apps/api/src/lib/anima-api.ts`

- [ ] **Step 1: Create the API client**

Create `apps/api/src/lib/anima-api.ts`:

```typescript
interface ChatResponse {
  response: string;
  model: string;
  provider: string;
  toolsUsed: string[];
}

interface TelegramLinkResponse {
  chatId: number;
  userId: number;
}

class AnimaApiClient {
  private baseUrl: string;
  private unlockToken: string | null = null;
  private username: string;
  private password: string;

  constructor() {
    this.baseUrl = process.env.PYTHON_API_BASE || "http://127.0.0.1:3031/api";
    this.username = process.env.ANIMA_USERNAME || "";
    this.password = process.env.ANIMA_PASSWORD || "";
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.unlockToken) {
      h["x-anima-unlock"] = this.unlockToken;
    }
    return h;
  }

  async login(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: this.username,
        password: this.password,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Login failed: ${res.status} ${body}`);
    }

    const data = await res.json();
    this.unlockToken = data.unlockToken;
    console.log("[anima-api] Authenticated successfully");
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });

    // Auto-retry on 401
    if (res.status === 401 && this.username) {
      await this.login();
      const retry = await fetch(url, {
        method,
        headers: this.headers(),
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!retry.ok) {
        const text = await retry.text().catch(() => "");
        throw new Error(`API ${method} ${path} failed after re-auth: ${retry.status} ${text}`);
      }
      return retry.json() as Promise<T>;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`API ${method} ${path} failed: ${res.status} ${text}`);
    }

    return res.json() as Promise<T>;
  }

  async chat(message: string, userId: number): Promise<ChatResponse> {
    return this.request<ChatResponse>("POST", "/chat", {
      message,
      userId,
      stream: false,
    });
  }

  async linkTelegram(
    chatId: number,
    userId: number,
    linkSecret?: string,
  ): Promise<TelegramLinkResponse> {
    return this.request<TelegramLinkResponse>("POST", "/telegram/link", {
      chatId,
      userId,
      ...(linkSecret ? { linkSecret } : {}),
    });
  }

  async unlinkTelegram(chatId: number): Promise<void> {
    await this.request("DELETE", "/telegram/link", { chatId });
  }

  async lookupTelegram(chatId: number): Promise<number | null> {
    try {
      const data = await this.request<TelegramLinkResponse>(
        "GET",
        `/telegram/link?chatId=${chatId}`,
      );
      return data.userId;
    } catch (err) {
      if (err instanceof Error && err.message.includes("404")) {
        return null;
      }
      throw err;
    }
  }
}

export const animaApi = new AnimaApiClient();
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/lib/anima-api.ts
git commit -m "feat(api): add Python API HTTP client for bot gateway"
```

---

## Task 4: grammY Bot + Webhook Setup

Build the Telegram bot using grammY and wire it into Hono.

**Files:**
- Create: `apps/api/src/telegram/bot.ts`
- Create: `apps/api/src/telegram/setup.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Create the bot**

Create `apps/api/src/telegram/bot.ts`:

```typescript
import { Bot } from "grammy";
import { animaApi } from "../lib/anima-api";

const token = process.env.TELEGRAM_BOT_TOKEN || "";

export const bot = new Bot(token);

const LINK_SECRET = process.env.TELEGRAM_LINK_SECRET;
const MAX_TG_LENGTH = 4096;

function splitMessage(text: string): string[] {
  if (text.length <= MAX_TG_LENGTH) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_TG_LENGTH) {
      chunks.push(remaining);
      break;
    }
    // Try to split at last newline or space within limit
    let splitAt = remaining.lastIndexOf("\n", MAX_TG_LENGTH);
    if (splitAt <= 0) splitAt = remaining.lastIndexOf(" ", MAX_TG_LENGTH);
    if (splitAt <= 0) splitAt = MAX_TG_LENGTH;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

// /start
bot.command("start", async (ctx) => {
  const parts = [
    "ANIMA is online.",
    "",
    "Use /link <userId>" + (LINK_SECRET ? " <linkSecret>" : "") + " to connect this chat.",
    "Use /unlink to disconnect.",
  ];
  await ctx.reply(parts.join("\n"));
});

// /link <userId> [linkSecret]
bot.command("link", async (ctx) => {
  const args = ctx.match.split(/\s+/).filter(Boolean);
  const userId = Number(args[0]);

  if (!args[0] || !Number.isInteger(userId) || userId <= 0) {
    await ctx.reply(
      "Usage: /link <userId>" + (LINK_SECRET ? " <linkSecret>" : ""),
    );
    return;
  }

  const secret = args[1];

  try {
    const result = await animaApi.linkTelegram(
      ctx.chat.id,
      userId,
      secret,
    );
    await ctx.reply(
      `Linked to user ${result.userId}. You can now chat with ANIMA here.`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("403")) {
      await ctx.reply("Invalid link secret.");
    } else if (msg.includes("404")) {
      await ctx.reply(`User ${userId} not found.`);
    } else {
      console.error("[telegram] link failed:", msg);
      await ctx.reply("Failed to link. Check logs for details.");
    }
  }
});

// /unlink
bot.command("unlink", async (ctx) => {
  try {
    await animaApi.unlinkTelegram(ctx.chat.id);
    await ctx.reply("Chat unlinked.");
  } catch (err) {
    console.error("[telegram] unlink failed:", err);
    await ctx.reply("Failed to unlink.");
  }
});

// Regular messages
bot.on("message:text", async (ctx) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text;

  const userId = await animaApi.lookupTelegram(chatId);
  if (userId === null) {
    await ctx.reply(
      "This chat is not linked. Use /link <userId>" +
        (LINK_SECRET ? " <linkSecret>" : "") +
        " to connect.",
    );
    return;
  }

  await ctx.replyWithChatAction("typing");

  try {
    const result = await animaApi.chat(text, userId);
    const chunks = splitMessage(result.response || "[empty response]");
    for (const chunk of chunks) {
      await ctx.reply(chunk);
    }
  } catch (err) {
    console.error("[telegram] chat failed:", err);
    await ctx.reply("Something went wrong. Please try again.");
  }
});
```

- [ ] **Step 2: Create webhook setup**

Create `apps/api/src/telegram/setup.ts`:

```typescript
import { bot } from "./bot";

export async function setupTelegramWebhook(): Promise<void> {
  const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
  const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!webhookUrl) {
    console.warn(
      "[telegram] TELEGRAM_WEBHOOK_URL not set — skipping webhook registration",
    );
    return;
  }

  await bot.api.setWebhook(webhookUrl, {
    secret_token: secretToken,
  });

  console.log(`[telegram] Webhook registered: ${webhookUrl}`);
}
```

- [ ] **Step 3: Wire bot into `index.ts`**

Replace `apps/api/src/index.ts` with:

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { webhookCallback } from "grammy";
import { startDiscordGatewayRelay } from "./discord/gateway-relay";
import { animaApi } from "./lib/anima-api";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: [
      "http://localhost:1420",
      "http://localhost:5173",
      "http://tauri.localhost",
      "https://tauri.localhost",
      "tauri://localhost",
    ],
    credentials: true,
  }),
);

// Health
app.get("/", (c) => c.json({ name: "ANIMA Bot Gateway", version: "0.2.0" }));
app.get("/health", (c) =>
  c.json({ status: "healthy", service: "bot-gateway" }),
);

// Telegram webhook (conditional)
if (process.env.TELEGRAM_BOT_TOKEN) {
  const { bot } = await import("./telegram/bot");
  const { setupTelegramWebhook } = await import("./telegram/setup");

  const handleUpdate = webhookCallback(bot, "std/http", {
    secretToken: process.env.TELEGRAM_WEBHOOK_SECRET,
  });
  app.post("/api/telegram/webhook", (c) => handleUpdate(c.req.raw));

  // Authenticate with Python API, then register webhook
  animaApi
    .login()
    .then(() => setupTelegramWebhook())
    .catch((err) =>
      console.error("[startup] Telegram setup failed:", err.message),
    );
}

// Discord gateway relay
startDiscordGatewayRelay();

export default {
  port: 3033,
  hostname: "127.0.0.1",
  fetch: app.fetch,
};

export { app };
```

- [ ] **Step 4: Verify build**

```bash
cd apps/api && bun build src/index.ts --outdir dist --target bun
```

Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/telegram/ apps/api/src/index.ts
git commit -m "feat(telegram): add grammY bot with webhook support

Commands: /start, /link, /unlink
Proxies messages to Python API via anima-api client.
Auto-registers webhook on startup if TELEGRAM_WEBHOOK_URL is set."
```

---

## Task 5: Integration Test & Verification

Verify everything works end-to-end.

**Files:**
- No new files

- [ ] **Step 1: Run Python test suite**

```bash
cd apps/server && python -m pytest tests/test_telegram_routes.py -v
```

Expected: All telegram route tests pass.

- [ ] **Step 2: Run full Python test suite to check for regressions**

```bash
cd apps/server && python -m pytest --tb=short -q
```

Expected: All existing tests still pass (746+).

- [ ] **Step 3: Verify Hono gateway builds cleanly**

```bash
cd apps/api && bun build src/index.ts --outdir dist --target bun
```

Expected: Build succeeds, no import errors for deleted modules.

- [ ] **Step 4: Verify Hono gateway starts without TELEGRAM_BOT_TOKEN**

```bash
cd apps/api && TELEGRAM_BOT_TOKEN= timeout 3 bun run src/index.ts 2>&1 || true
```

Expected: Starts cleanly. No telegram-related errors. Discord relay logs warning if not configured.

- [ ] **Step 5: Commit any fixes**

If any issues were found and fixed during verification, commit them:

```bash
git add -A
git commit -m "fix: address integration issues from telegram adapter"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Python telegram link routes | 4 files (schemas, routes, main.py, tests) |
| 2 | Strip legacy code from apps/api | Delete ~20 dirs/files, rewrite package.json + index.ts |
| 3 | Python API client | 1 file (anima-api.ts) |
| 4 | grammY bot + webhook | 3 files (bot.ts, setup.ts, index.ts) |
| 5 | Integration verification | No new files, run tests |
