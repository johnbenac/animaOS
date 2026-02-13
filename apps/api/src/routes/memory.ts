// Memory routes — browse, read, write, and delete memory files via REST API

import { Hono } from "hono";
import {
  listAllMemories,
  listMemories,
  readMemory,
  writeMemory,
  appendMemory,
  deleteMemory,
  searchMemories,
  writeJournalEntry,
  type MemorySection,
} from "../memory";

const memory = new Hono();

// --- List all memories for a user (or filter by section) ---
// GET /api/memory/:userId?section=user
memory.get("/:userId", async (c) => {
  const userId = parseInt(c.req.param("userId"));
  const section = c.req.query("section") as MemorySection | undefined;

  if (isNaN(userId)) return c.json({ error: "Invalid userId" }, 400);

  const entries = section
    ? await listMemories(section, userId)
    : await listAllMemories(userId);

  return c.json({ count: entries.length, memories: entries });
});

// --- Search memories ---
// GET /api/memory/:userId/search?q=query
memory.get("/:userId/search", async (c) => {
  const userId = parseInt(c.req.param("userId"));
  const query = c.req.query("q") || "";

  if (isNaN(userId)) return c.json({ error: "Invalid userId" }, 400);
  if (!query) return c.json({ error: "Missing query param 'q'" }, 400);

  const results = await searchMemories(userId, query);
  return c.json({ count: results.length, results });
});

// --- Read a specific memory file ---
// GET /api/memory/:userId/:section/:filename
memory.get("/:userId/:section/:filename", async (c) => {
  const userId = parseInt(c.req.param("userId"));
  const section = c.req.param("section") as MemorySection;
  const filename = c.req.param("filename");

  if (isNaN(userId)) return c.json({ error: "Invalid userId" }, 400);

  try {
    const file = await readMemory(section, userId, filename);
    return c.json(file);
  } catch {
    return c.json({ error: "Memory file not found" }, 404);
  }
});

// --- Write/overwrite a memory file ---
// PUT /api/memory/:userId/:section/:filename
// Body: { content: string, tags?: string[] }
memory.put("/:userId/:section/:filename", async (c) => {
  const userId = parseInt(c.req.param("userId"));
  const section = c.req.param("section") as MemorySection;
  const filename = c.req.param("filename");

  if (isNaN(userId)) return c.json({ error: "Invalid userId" }, 400);

  const body = await c.req.json<{ content: string; tags?: string[] }>();
  if (!body.content) return c.json({ error: "Missing content" }, 400);

  const file = await writeMemory(section, userId, filename, body.content, {
    category: section,
    tags: body.tags || [],
    source: "user",
  });

  return c.json(file);
});

// --- Append to a memory file ---
// POST /api/memory/:userId/:section/:filename
// Body: { content: string }
memory.post("/:userId/:section/:filename", async (c) => {
  const userId = parseInt(c.req.param("userId"));
  const section = c.req.param("section") as MemorySection;
  const filename = c.req.param("filename");

  if (isNaN(userId)) return c.json({ error: "Invalid userId" }, 400);

  const body = await c.req.json<{ content: string }>();
  if (!body.content) return c.json({ error: "Missing content" }, 400);

  const file = await appendMemory(section, userId, filename, body.content, {
    category: section,
    source: "user",
  });

  return c.json(file);
});

// --- Delete a memory file ---
// DELETE /api/memory/:userId/:section/:filename
memory.delete("/:userId/:section/:filename", async (c) => {
  const userId = parseInt(c.req.param("userId"));
  const section = c.req.param("section") as MemorySection;
  const filename = c.req.param("filename");

  if (isNaN(userId)) return c.json({ error: "Invalid userId" }, 400);

  const deleted = await deleteMemory(section, userId, filename);
  return c.json({ deleted });
});

// --- Write journal entry ---
// POST /api/memory/:userId/journal
// Body: { entry: string, date?: string }
memory.post("/:userId/journal", async (c) => {
  const userId = parseInt(c.req.param("userId"));

  if (isNaN(userId)) return c.json({ error: "Invalid userId" }, 400);

  const body = await c.req.json<{ entry: string; date?: string }>();
  if (!body.entry) return c.json({ error: "Missing entry" }, 400);

  const file = await writeJournalEntry(userId, body.entry, body.date);
  return c.json(file);
});

export default memory;
