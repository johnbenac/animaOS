import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";

const app = new Hono();

const userSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6),
  name: z.string().min(1),
  gender: z.enum(["male", "female", "other"]).optional(),
  age: z.number().int().positive().optional(),
  birthday: z.string().optional(),
});

const userUpdateSchema = userSchema.partial();

// Create user
app.post("/", zValidator("json", userSchema), async (c) => {
  const data = c.req.valid("json");
  const [user] = await db.insert(users).values(data).returning();
  return c.json(user, 201);
});

// Get all users
app.get("/", async (c) => {
  const allUsers = await db.select().from(users);
  return c.json(allUsers);
});

// Get user by id
app.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const [user] = await db.select().from(users).where(eq(users.id, id));
  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json(user);
});

// Update user
app.put("/:id", zValidator("json", userUpdateSchema), async (c) => {
  const id = Number(c.req.param("id"));
  const data = c.req.valid("json");
  const [user] = await db
    .update(users)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(eq(users.id, id))
    .returning();
  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json(user);
});

// Delete user
app.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const [user] = await db.delete(users).where(eq(users.id, id)).returning();
  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json({ message: "User deleted" });
});

export default app;
