/**
 * Config Loader Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig, clearConfigCache } from "../../src/core/config.js";
import { writeFile, unlink, mkdir, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_CONFIG_PATH = join(tmpdir(), "anima-mod-test-config.yaml");

describe("loadConfig", () => {
  beforeEach(async () => {
    clearConfigCache();
    // Clean up any existing test file
    try {
      await unlink(TEST_CONFIG_PATH);
    } catch {
      // Ignore if doesn't exist
    }
  });

  afterEach(async () => {
    clearConfigCache();
    try {
      await unlink(TEST_CONFIG_PATH);
    } catch {
      // Ignore
    }
  });

  it("should return default config when file doesn't exist", async () => {
    const config = await loadConfig("/nonexistent/config.yaml");
    expect(config.modules).toEqual([]);
  });

  it("should parse YAML config correctly", async () => {
    const yamlContent = `
modules:
  - id: test-mod
    path: ./mods/test
    config:
      key: value
      number: 42

core:
  port: 3034
  anima:
    baseUrl: http://localhost:3031/api
`;
    await writeFile(TEST_CONFIG_PATH, yamlContent, "utf-8");

    const config = await loadConfig(TEST_CONFIG_PATH);

    expect(config.modules).toHaveLength(1);
    expect(config.modules?.[0].id).toBe("test-mod");
    expect(config.modules?.[0].config.key).toBe("value");
    expect(config.core?.port).toBe(3034);
    expect(config.core?.anima?.baseUrl).toBe("http://localhost:3031/api");
  });

  it("should substitute environment variables", async () => {
    process.env.TEST_TOKEN = "secret-token-123";
    
    const yamlContent = `
modules:
  - id: telegram
    path: ./mods/telegram
    config:
      token: \${TEST_TOKEN}
`;
    await writeFile(TEST_CONFIG_PATH, yamlContent, "utf-8");

    const config = await loadConfig(TEST_CONFIG_PATH);

    expect(config.modules?.[0].config.token).toBe("secret-token-123");
    
    delete process.env.TEST_TOKEN;
  });

  it("should use default values for missing env vars", async () => {
    const yamlContent = `
modules:
  - id: test
    config:
      value: \${MISSING_VAR:-default_value}
`;
    await writeFile(TEST_CONFIG_PATH, yamlContent, "utf-8");

    const config = await loadConfig(TEST_CONFIG_PATH);

    expect(config.modules?.[0].config.value).toBe("default_value");
  });
});
