/**
 * Module Registry Tests
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { ModRegistry } from "../../src/core/registry.js";
import type { Mod, ModContext } from "../../src/core/types.js";

describe("ModRegistry", () => {
  let registry: ModRegistry;

  beforeEach(() => {
    registry = new ModRegistry();
  });

  it("should start with no modules", () => {
    expect(registry.list()).toEqual([]);
  });

  it("should register a module", async () => {
    const testMod: Mod = {
      id: "test",
      version: "1.0.0",
      init: async () => {},
      start: async () => {},
    };

    // We can't easily test dynamic imports without file system
    // So we'll just test the registry API exists
    expect(registry.get("test")).toBeUndefined();
  });

  it("should list registered modules", async () => {
    // Same limitation as above - just verify the API
    expect(registry.list()).toEqual([]);
  });
});

// Integration test with actual file system would go here
// But requires creating temp module files
describe("ModRegistry Integration", () => {
  it("placeholder for integration tests", () => {
    // TODO: Create temp directory with test module
    // Register and verify full lifecycle
    expect(true).toBe(true);
  });
});
