import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";

const app = new Hono();

// Register
app.post("/register", async (c) => {
  const { username, password, name } = await c.req.json();

  if (!username || !password || !name) {
    return c.json({ error: "username, password, and name are required" }, 400);
  }

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
});

// Login
app.post("/login", async (c) => {
  const { username, password } = await c.req.json();

  if (!username || !password) {
    return c.json({ error: "username and password are required" }, 400);
  }

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
});

export default app;
