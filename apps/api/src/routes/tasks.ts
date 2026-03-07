import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, asc } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import {
  cancelReminderJobsForTask,
  syncReminderJobsForTask,
} from "../cron/task-reminders";
import * as chrono from "chrono-node";

/** Validate an ISO datetime string, or try chrono-node NLP parsing. Returns ISO or null. */
function resolveDueDate(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Try strict ISO first (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss)
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(trimmed)) {
    const d = new Date(trimmed.length === 10 ? `${trimmed}T00:00:00` : trimmed);
    if (!Number.isNaN(d.getTime())) return formatISO(d);
  }

  // Fall back to chrono-node NLP parsing
  const results = chrono.parse(trimmed, { instant: new Date() });
  if (results.length > 0) {
    const parsed = results[0].start.date();
    if (!Number.isNaN(parsed.getTime())) return formatISO(parsed);
  }

  return null;
}

function formatISO(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const tasks = new Hono();

// GET /tasks?userId=1
tasks.get(
  "/",
  zValidator(
    "query",
    z.object({
      userId: z.string().transform(Number),
    }),
  ),
  async (c) => {
    const { userId } = c.req.valid("query");
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.userId, userId))
      .orderBy(asc(schema.tasks.done), asc(schema.tasks.createdAt));
    return c.json(rows);
  },
);

// POST /tasks — create
tasks.post(
  "/",
  zValidator(
    "json",
    z.object({
      userId: z.number(),
      text: z.string().min(1),
      priority: z.number().int().min(0).max(2).optional(),
      dueDate: z.string().optional(),
      dueDateRaw: z.string().optional(),
    }),
  ),
  async (c) => {
    const { userId, text, priority, dueDate, dueDateRaw } = c.req.valid("json");
    // Resolution: dueDateRaw (chrono NLP) → dueDate (ISO or NLP) → parse from task text
    const resolvedDueDate =
      resolveDueDate(dueDateRaw) ??
      resolveDueDate(dueDate) ??
      resolveDueDate(text);

    const [task] = await db
      .insert(schema.tasks)
      .values({
        userId,
        text,
        priority: priority ?? 0,
        dueDate: resolvedDueDate,
      })
      .returning();

    await syncReminderJobsForTask(task);

    return c.json(task, 201);
  },
);

// PUT /tasks/:id — update
tasks.put(
  "/:id",
  zValidator(
    "json",
    z.object({
      text: z.string().min(1).optional(),
      done: z.boolean().optional(),
      priority: z.number().int().min(0).max(2).optional(),
      dueDate: z.string().nullable().optional(),
    }),
  ),
  async (c) => {
    const id = Number(c.req.param("id"));
    const updates = c.req.valid("json");

    const data: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (updates.text !== undefined) data.text = updates.text;
    if (updates.priority !== undefined) data.priority = updates.priority;
    if (updates.dueDate !== undefined) {
      data.dueDate =
        updates.dueDate === null ? null : resolveDueDate(updates.dueDate);
    }
    if (updates.done !== undefined) {
      data.done = updates.done;
      data.completedAt = updates.done ? new Date().toISOString() : null;
    }

    const [task] = await db
      .update(schema.tasks)
      .set(data)
      .where(eq(schema.tasks.id, id))
      .returning();

    if (!task) return c.json({ error: "Task not found" }, 404);

    await syncReminderJobsForTask(task);

    return c.json(task);
  },
);

// DELETE /tasks/:id
tasks.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const [deleted] = await db
    .delete(schema.tasks)
    .where(eq(schema.tasks.id, id))
    .returning();

  if (!deleted) return c.json({ error: "Task not found" }, 404);
  await cancelReminderJobsForTask(id, "Task deleted");
  return c.json({ status: "deleted" });
});

export default tasks;
