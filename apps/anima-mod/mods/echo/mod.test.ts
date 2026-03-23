/**
 * Echo Module Tests
 * 
 * Co-located with mod.ts
 */

import { describe, it, expect } from "bun:test";
import echoMod from "./mod.js";
import { createMockContext } from "../../tests/setup.js";

describe("Echo Module", () => {
  it("should have correct metadata", () => {
    expect(echoMod.id).toBe("echo");
    expect(echoMod.version).toBe("1.0.0");
  });

  it("should initialize without errors", async () => {
    const ctx = createMockContext();
    await echoMod.init(ctx);
  });

  it("should provide a router with endpoints", () => {
    const router = echoMod.getRouter?.();
    expect(router).toBeDefined();
  });

  it("should have start/stop lifecycle methods", () => {
    expect(typeof echoMod.start).toBe("function");
    expect(typeof echoMod.stop).toBe("function");
  });

  it("should log config on init", async () => {
    let loggedConfig: unknown;
    const ctx = createMockContext({
      logger: {
        debug: () => {},
        info: (msg: string, meta?: unknown) => {
          if (msg.includes("initialized")) loggedConfig = meta;
        },
        warn: () => {},
        error: () => {},
      },
      config: { prefix: "Test:" },
    });

    await echoMod.init(ctx);
    expect(loggedConfig).toEqual({ prefix: "Test:" });
  });
});
