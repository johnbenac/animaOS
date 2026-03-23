/**
 * Module Store Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ModStoreImpl } from "../../src/core/store.js";
import { unlink, mkdir, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DB_PATH = join(tmpdir(), "anima-mod-test.db");

describe("ModStoreImpl", () => {
  let store: ModStoreImpl;

  beforeEach(async () => {
    // Clean up
    try {
      await unlink(TEST_DB_PATH);
    } catch {
      // Ignore
    }
    
    store = new ModStoreImpl("test-mod", TEST_DB_PATH);
    await store.init();
  });

  afterEach(async () => {
    store.close();
    try {
      await unlink(TEST_DB_PATH);
    } catch {
      // Ignore
    }
  });

  it("should store and retrieve values", async () => {
    await store.set("key1", "value1");
    const value = await store.get("key1");
    expect(value).toBe("value1");
  });

  it("should store complex objects", async () => {
    const obj = { name: "test", nested: { value: 42 } };
    await store.set("obj", obj);
    const retrieved = await store.get<typeof obj>("obj");
    expect(retrieved).toEqual(obj);
  });

  it("should return null for non-existent keys", async () => {
    const value = await store.get("nonexistent");
    expect(value).toBeNull();
  });

  it("should check if key exists", async () => {
    await store.set("exists", true);
    expect(await store.has("exists")).toBe(true);
    expect(await store.has("notexists")).toBe(false);
  });

  it("should delete keys", async () => {
    await store.set("todelete", "value");
    expect(await store.has("todelete")).toBe(true);
    
    await store.delete("todelete");
    expect(await store.has("todelete")).toBe(false);
    expect(await store.get("todelete")).toBeNull();
  });

  it("should update existing values", async () => {
    await store.set("key", "original");
    await store.set("key", "updated");
    const value = await store.get("key");
    expect(value).toBe("updated");
  });

  it("should isolate namespaces between modules", async () => {
    const store2 = new ModStoreImpl("other-mod", TEST_DB_PATH);
    await store2.init();

    await store.set("shared", "value1");
    await store2.set("shared", "value2");

    expect(await store.get("shared")).toBe("value1");
    expect(await store2.get("shared")).toBe("value2");

    store2.close();
  });
});
