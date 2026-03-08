// Zod schemas for memory route validation

import { z } from "zod";

export const writeMemorySchema = z.object({
  content: z.string().min(1),
  tags: z.array(z.string()).optional(),
});

export const appendMemorySchema = z.object({
  content: z.string().min(1),
});

export const journalEntrySchema = z.object({
  entry: z.string().min(1),
  date: z.string().optional(),
});
