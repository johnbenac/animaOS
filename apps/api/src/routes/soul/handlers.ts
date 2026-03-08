// Soul route handlers

import type { Context } from "hono";
import { readFileSync, writeFileSync } from "node:fs";
import { invalidateSoulCache } from "../../agent/graph";
import { SOUL_PATH } from "../../lib/runtime-paths";

function getSoulPath(): string {
  return SOUL_PATH;
}

// GET /soul
export function getSoul(c: Context) {
  const path = getSoulPath();

  try {
    const content = readFileSync(path, "utf-8");
    return c.json({ content, path });
  } catch {
    return c.json({ content: "", path }, 200);
  }
}

// PUT /soul
export function updateSoul(c: Context) {
  const { content } = c.req.valid("json" as never);
  const path = getSoulPath();

  try {
    writeFileSync(path, content, "utf-8");
    invalidateSoulCache();
    return c.json({ status: "saved", path });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
}
