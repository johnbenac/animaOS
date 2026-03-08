// Auth route handlers

import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { users } from "../../db/schema";

// POST /auth/register
export async function register(c: Context) {
  const { username, password, name } = c.req.valid("json" as never);

  // Check if username already exists
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.username, username));
  if (existing) {
    return c.json({ error: "Username already taken" }, 409);
  }

  const hashedPassword = await Bun.password.hash(password);

  const [user] = await db
    .insert(users)
    .values({ username, password: hashedPassword, name })
    .returning({
      id: users.id,
      username: users.username,
      name: users.name,
      createdAt: users.createdAt,
    });

  return c.json(user, 201);
}

// POST /auth/login
export async function login(c: Context) {
  const { username, password } = c.req.valid("json" as never);

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.username, username));

  if (!user) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const valid = await Bun.password.verify(password, user.password);
  if (!valid) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  return c.json({
    id: user.id,
    username: user.username,
    name: user.name,
    message: "Login successful",
  });
}
