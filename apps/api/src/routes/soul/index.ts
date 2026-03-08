// Soul routes — read and update ANIMA's soul definition

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { updateSoulSchema } from "./schema";
import { getSoul, updateSoul } from "./handlers";

const soul = new Hono();

soul.get("/", getSoul);
soul.put("/", zValidator("json", updateSoulSchema), updateSoul);

export default soul;
