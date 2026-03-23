# anima-mod

**Anima Module System** — The external presence layer for ANIMA.

anima-mod is a modular system that connects ANIMA's cognitive core to the external world (Telegram, WhatsApp, Discord, webhooks, etc.). It runs as a separate service and communicates with the Python cognitive core via HTTP API.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  anima-mod (this service) - Elysia + Bun                        │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Modules   │  │    Tasks    │  │   Hooks     │         │
│  │  (channels) │  │ (scheduler) │  │  (webhooks) │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ HTTP API
┌─────────────────────────────────────────────────────────────┐
│  ANIMA Cognitive Core (apps/server) - Python + FastAPI      │
│                                                             │
│  • Reasoning & cognition                                    │
│  • Memory system                                            │
│  • Agent runtime                                            │
│  • Emotional state                                          │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Install dependencies
bun install

# Configure
cp anima-mod.config.yaml anima-mod.config.local.yaml
# Edit anima-mod.config.local.yaml with your settings

# Run development server
bun run dev

# Or build and run
bun run build
bun run start
```

## Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/core/store.test.ts

# Watch mode
bun run test:watch
```

See [tests/README.md](tests/README.md) for testing details.

## Creating a Module

Modules live in `mods/` (built-in) or `user-mods/` (user-installed).

```typescript
// user-mods/my-module/mod.ts
import type { Mod, ModContext } from "anima-mod/core";

export default {
  id: "my-module",
  version: "1.0.0",

  async init(ctx: ModContext) {
    ctx.logger.info("Initializing my-module");
    // Setup: load config, create clients, etc.
  },

  getRouter() {
    // Return Elysia router for HTTP endpoints
    return new Elysia()
      .get("/", () => "Hello from my-module");
  },

  async start() {
    // Begin operations
  },

  async stop() {
    // Cleanup
  }
} satisfies Mod;
```

## Module Context

Each module receives a `ModContext` with:

- `config` - Module configuration from YAML
- `logger` - Structured logger
- `anima` - HTTP client to cognitive core
- `store` - Module-private KV store (SQLite)
- `dispatch` - Cross-module message bus

## Configuration

See `anima-mod.config.yaml` for example configuration.

```yaml
modules:
  - id: telegram
    path: ./mods/telegram
    config:
      token: ${TELEGRAM_BOT_TOKEN}

core:
  port: 3034
  anima:
    baseUrl: http://127.0.0.1:3031/api
    username: ${ANIMA_USERNAME}
    password: ${ANIMA_PASSWORD}
```

## License

MIT
