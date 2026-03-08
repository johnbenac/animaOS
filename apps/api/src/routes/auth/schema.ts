// Zod schemas for auth route validation

import { z } from "zod";

export const registerSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  name: z.string().min(1),
});

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
