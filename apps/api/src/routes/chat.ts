// Chat routes — conversation with the agent

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { runAgent, streamAgent, resetAgentThread } from "../agent";
import { generateBrief } from "../agent/brief";
import { checkNudges } from "../agent/nudge";
import { consolidateMemories } from "../agent/consolidate";
import { readMemory, listMemories, listAllMemories } from "../memory";

const chat = new Hono();

// POST /chat — send a message, get a response (SSE stream)
chat.post(
  "/",
  zValidator(
    "json",
    z.object({
      message: z.string().min(1),
      userId: z.number(),
      stream: z.boolean().optional().default(true),
    })
  ),
  async (c) => {
    const { message, userId, stream } = c.req.valid("json");

    if (!stream) {
      // Non-streaming response
      try {
        const result = await runAgent(message, userId);
        return c.json(result);
      } catch (err: any) {
        return c.json({ error: err.message }, 500);
      }
    }

    // SSE streaming
    return new Response(
      new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          const send = (event: string, data: unknown) => {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
            );
          };

          try {
            for await (const chunk of streamAgent(message, userId)) {
              send("chunk", { content: chunk });
            }
            send("done", { status: "complete" });
          } catch (err: any) {
            send("error", { error: err.message });
          } finally {
            controller.close();
          }
        },
      }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      }
    );
  }
);

// GET /chat/history — get message history
chat.get(
  "/history",
  zValidator(
    "query",
    z.object({
      userId: z.string().transform(Number),
      limit: z.string().optional().default("50").transform(Number),
    })
  ),
  async (c) => {
    const { userId, limit } = c.req.valid("query");
    const messages = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.userId, userId))
      .orderBy(desc(schema.messages.id))
      .limit(limit);

    return c.json(messages.reverse());
  }
);

// DELETE /chat/history — clear history
chat.delete(
  "/history",
  zValidator("json", z.object({ userId: z.number() })),
  async (c) => {
    const { userId } = c.req.valid("json");
    await db
      .delete(schema.messages)
      .where(eq(schema.messages.userId, userId));
    await resetAgentThread(userId).catch(() => {
      // Ignore reset failures so chat history clear still succeeds.
    });
    return c.json({ status: "cleared" });
  }
);

// GET /chat/brief — daily briefing
chat.get(
  "/brief",
  zValidator(
    "query",
    z.object({
      userId: z.string().transform(Number),
    })
  ),
  async (c) => {
    const { userId } = c.req.valid("query");

    try {
      const brief = await generateBrief(userId);
      return c.json(brief);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  }
);

// GET /chat/nudges — check for actionable nudges
chat.get(
  "/nudges",
  zValidator(
    "query",
    z.object({
      userId: z.string().transform(Number),
    })
  ),
  async (c) => {
    const { userId } = c.req.valid("query");

    try {
      const nudges = await checkNudges(userId);
      return c.json({ nudges });
    } catch (err: any) {
      return c.json({ nudges: [] });
    }
  }
);

// GET /chat/home — structured data for the home dashboard
chat.get(
  "/home",
  zValidator(
    "query",
    z.object({
      userId: z.string().transform(Number),
    })
  ),
  async (c) => {
    const { userId } = c.req.valid("query");

    // Gather all data in parallel
    const [focusResult, taskRows, journalEntries, allMemories, messageCount] = await Promise.all([
      readMemory("user", userId, "current-focus").catch(() => null),
      db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.userId, userId))
        .catch(() => []),
      listMemories("journal", userId).catch(() => []),
      listAllMemories(userId).catch(() => []),
      db
        .select({ id: schema.messages.id })
        .from(schema.messages)
        .where(eq(schema.messages.userId, userId))
        .then((rows) => rows.length)
        .catch(() => 0),
    ]);

    // Parse current focus
    let currentFocus: string | null = null;
    if (focusResult) {
      const line = focusResult.content.split("\n").find((l) => l.trim().match(/^- \[[ ]\]\s+/));
      if (line) currentFocus = line.replace(/^- \[ \]\s+/, "").trim();
    }

    // Tasks come from DB now
    const tasks = taskRows.map((t) => ({
      id: t.id,
      text: t.text,
      done: t.done,
      priority: t.priority,
      dueDate: t.dueDate,
    }));

    // Journal streak — count consecutive recent days with entries
    const journalDateSet = new Set(
      journalEntries
        .map((e) => { const m = e.path.match(/(\d{4}-\d{2}-\d{2})\.md$/); return m ? m[1] : null; })
        .filter(Boolean)
    );
    let journalStreak = 0;
    const today = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      if (journalDateSet.has(key)) {
        journalStreak++;
      } else if (i > 0) {
        break;
      }
      // skip today if no entry yet (don't break streak)
    }

    return c.json({
      currentFocus,
      tasks,
      journalStreak,
      journalTotal: journalEntries.length,
      memoryCount: allMemories.length,
      messageCount,
    });
  }
);

// POST /chat/consolidate — trigger memory consolidation
chat.post(
  "/consolidate",
  zValidator(
    "json",
    z.object({
      userId: z.number(),
    }),
  ),
  async (c) => {
    const { userId } = c.req.valid("json");

    try {
      const result = await consolidateMemories(userId);
      return c.json(result);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  },
);

export default chat;
