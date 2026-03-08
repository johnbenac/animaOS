// Zod schemas for user route validation

import { z } from "zod";

export const userSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6),
  name: z.string().min(1),
  gender: z.enum(["male", "female", "other"]).optional(),
  age: z.number().int().positive().optional(),
  birthday: z.string().optional(),
});

export const userUpdateSchema = userSchema.partial();
