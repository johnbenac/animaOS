// Auth routes — register and login

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { registerSchema, loginSchema } from "./schema";
import { register, login } from "./handlers";

const auth = new Hono();

auth.post("/register", zValidator("json", registerSchema), register);
auth.post("/login", zValidator("json", loginSchema), login);

export default auth;
