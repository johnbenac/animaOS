// Agent config routes — provider, model, API keys

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { updateConfigSchema } from "./schema";
import { getProviders, getConfig, updateConfig } from "./handlers";

const config = new Hono();

config.get("/providers", getProviders);
config.get("/:userId", getConfig);
config.put("/:userId", zValidator("json", updateConfigSchema), updateConfig);

export default config;
