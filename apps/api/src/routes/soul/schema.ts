// Zod schemas for soul route validation

import { z } from "zod";

export const updateSoulSchema = z.object({
  content: z.string().min(1),
});
