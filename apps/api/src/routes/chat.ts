// Chat routes — conversation with the agent

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { runAgent, streamAgent } from "../agent";
import { getProvider, listProviders, defaultModels } from "../llm";

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
          "Access-Control-Allow-Origin": "*",
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
    return c.json({ status: "cleared" });
  }
);

// GET /chat/memories — list memories
chat.get(
  "/memories",
  zValidator(
    "query",
    z.object({
      userId: z.string().transform(Number),
      category: z.string().optional(),
    })
  ),
  async (c) => {
    const { userId, category } = c.req.valid("query");
    let results = await db
      .select()
      .from(schema.memories)
      .where(eq(schema.memories.userId, userId));

    if (category) {
      results = results.filter((m) => m.category === category);
    }
    return c.json(results);
  }
);

// DELETE /chat/memories/:id
chat.delete("/memories/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await db.delete(schema.memories).where(eq(schema.memories.id, id));
  return c.json({ status: "deleted" });
});

export default chat;
