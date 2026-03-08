// Soul route handlers

import type { Context } from "hono";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { invalidateSoulCache } from "../../agent/graph";

function getSoulPath(): string {
  if (process.env.ANIMA_SOUL_PATH) return process.env.ANIMA_SOUL_PATH;

  const dir = process.env.ANIMA_SOUL_DIR;
  if (dir) return resolve(dir, "soul.md");

  // Try standard locations
  const candidates = [
    resolve(process.cwd(), "soul", "soul.md"),
    resolve(process.cwd(), "../../soul/soul.md"),
  ];

  for (const path of candidates) {
    if (existsSync(path)) return path;
  }

  // Default to project root soul dir
  return resolve(process.cwd(), "../../soul/soul.md");
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
