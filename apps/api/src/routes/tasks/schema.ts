// Zod schemas for task route validation

import { z } from "zod";

export const taskQuerySchema = z.object({
  userId: z.string().transform(Number),
});

export const createTaskSchema = z.object({
  userId: z.number(),
  text: z.string().min(1),
  priority: z.number().int().min(0).max(2).optional(),
  dueDate: z.string().optional(),
  dueDateRaw: z.string().optional(),
});

export const updateTaskSchema = z.object({
  text: z.string().min(1).optional(),
  done: z.boolean().optional(),
  priority: z.number().int().min(0).max(2).optional(),
  dueDate: z.string().nullable().optional(),
});
