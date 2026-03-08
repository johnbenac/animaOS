// Zod schemas for chat route validation

import { z } from "zod";

// POST /chat — send message
export const sendMessageSchema = z.object({
  message: z.string().min(1),
  userId: z.number(),
  stream: z.boolean().optional().default(true),
});

// GET /chat/history
export const historyQuerySchema = z.object({
  userId: z.string().transform(Number),
  limit: z.string().optional().default("50").transform(Number),
});

// DELETE /chat/history
export const clearHistorySchema = z.object({
  userId: z.number(),
});

// Shared userId-only query param
export const userIdQuerySchema = z.object({
  userId: z.string().transform(Number),
});

// POST /chat/consolidate
export const consolidateSchema = z.object({
  userId: z.number(),
});
