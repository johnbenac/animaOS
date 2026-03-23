// apps/animus/src/tools/bash.test.ts
import { describe, test, expect } from "bun:test";
import { executeBash } from "./bash";

describe("bash tool", () => {
  test("executes simple command and returns output", async () => {
    const result = await executeBash({ command: "echo hello" });
    expect(result.status).toBe("success");
    expect(result.result.trim()).toBe("hello");
  });

  test("returns error for failing command", async () => {
    const result = await executeBash({ command: "exit 1" });
    expect(result.status).toBe("error");
  });

  test(
    "respects timeout",
    async () => {
      const result = await executeBash({ command: "sleep 10", timeout: 500 });
      expect(result.status).toBe("error");
      expect(result.result.toLowerCase()).toContain("timed out");
    },
    { timeout: 10000 },
  );
});
