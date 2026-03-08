// User routes — CRUD for user accounts

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { userSchema, userUpdateSchema } from "./schema";
import {
  createUser,
  listUsers,
  getUser,
  updateUser,
  deleteUser,
} from "./handlers";

const users = new Hono();

users.post("/", zValidator("json", userSchema), createUser);
users.get("/", listUsers);
users.get("/:id", getUser);
users.put("/:id", zValidator("json", userUpdateSchema), updateUser);
users.delete("/:id", deleteUser);

export default users;
