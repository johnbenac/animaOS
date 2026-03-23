# anima-mod Tests

Test suite using Bun's built-in test runner (`bun:test`).

## Structure

Tests are **co-located** with source code:

```
mods/
├── echo/
│   ├── mod.ts           # Module source
│   └── mod.test.ts      # Module tests ← right next to it
├── telegram/
│   ├── mod.ts
│   └── mod.test.ts
└── discord/
    ├── mod.ts
    └── mod.test.ts

tests/
├── core/                # Core system tests
│   ├── config.test.ts
│   ├── store.test.ts
│   ├── dispatch.test.ts
│   └── registry.test.ts
├── setup.ts             # Test utilities
└── README.md            # This file
```

## Running Tests

```bash
# Run all tests (both core and mods)
bun test

# Run specific test file
bun test mods/telegram/mod.test.ts
bun test tests/core/store.test.ts

# Watch mode
bun run test:watch

# Filter by name
bun test --grep "should require token"
```

## Writing Tests

### For Core Components

```typescript
// tests/core/my-component.test.ts
import { describe, it, expect } from "bun:test";
import { myFunction } from "../../src/core/my-component.js";

describe("My Component", () => {
  it("should do something", () => {
    const result = myFunction();
    expect(result).toBe("expected");
  });
});
```

### For Modules (Co-located)

```typescript
// mods/my-module/mod.test.ts
import { describe, it, expect } from "bun:test";
import myMod from "./mod.js";
import { createMockContext } from "../../tests/setup.js";

describe("My Module", () => {
  it("should initialize", async () => {
    const ctx = createMockContext({ config: { token: "test" } });
    await myMod.init(ctx);
  });
});
```

## Test Utilities

Use `createMockContext()` from `tests/setup.ts`:

```typescript
import { createMockContext } from "../../tests/setup.js";

const ctx = createMockContext({
  config: { token: "test-token" },
  // Override any context properties
});
```

## Best Practices

1. **Co-locate module tests** - Keep `mod.test.ts` next to `mod.ts`
2. **Test behavior, not implementation** - Test what the module does
3. **Use mocks for external services** - Don't call real Telegram/Discord APIs
4. **Test error cases** - Invalid configs, missing tokens, etc.

## Coverage

| Component | Tests |
|-----------|-------|
| Core Config | ✅ YAML parsing, env substitution |
| Core Store | ✅ CRUD, namespaces, complex objects |
| Core Dispatch | ✅ Pub/sub, tasks, unsubscription |
| Core Registry | ✅ Module loading (integration TBD) |
| Echo Module | ✅ Lifecycle, router |
| Telegram Module | ✅ Config validation, lifecycle |
| Discord Module | ✅ Config validation, lifecycle |
