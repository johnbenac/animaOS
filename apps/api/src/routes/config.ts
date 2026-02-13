// Agent config routes — provider, model, API keys

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { listProviders, defaultModels } from "../llm";
import type { ProviderName } from "../llm/types";

const config = new Hono();

// GET /config/providers — list available providers and default models
config.get("/providers", (c) => {
  const providers = listProviders().map((name) => ({
    name,
    defaultModel: defaultModels[name],
    requiresApiKey: name !== "ollama",
  }));
  return c.json(providers);
});

// GET /config/:userId — get user's agent config
config.get("/:userId", async (c) => {
  const userId = Number(c.req.param("userId"));
  const [cfg] = await db
    .select()
    .from(schema.agentConfig)
    .where(eq(schema.agentConfig.userId, userId));

  if (!cfg) {
    return c.json({
      provider: "ollama",
      model: "llama3.1:8b",
      ollamaUrl: "http://localhost:11434",
      hasApiKey: false,
      systemPrompt: null,
    });
  }

  return c.json({
    provider: cfg.provider,
    model: cfg.model,
    ollamaUrl: cfg.ollamaUrl,
    hasApiKey: !!cfg.apiKey,
    systemPrompt: cfg.systemPrompt,
  });
});

// PUT /config/:userId — update agent config
config.put(
  "/:userId",
  zValidator(
    "json",
    z.object({
      provider: z.enum(["openrouter", "openai", "anthropic", "ollama"]),
      model: z.string().min(1),
      apiKey: z.string().optional(),
      ollamaUrl: z.string().optional(),
      systemPrompt: z.string().optional(),
    })
  ),
  async (c) => {
    const userId = Number(c.req.param("userId"));
    const data = c.req.valid("json");

    const [existing] = await db
      .select()
      .from(schema.agentConfig)
      .where(eq(schema.agentConfig.userId, userId));

    if (existing) {
      const updateData: Record<string, unknown> = {
        provider: data.provider,
        model: data.model,
        ollamaUrl: data.ollamaUrl || existing.ollamaUrl,
        systemPrompt: data.systemPrompt ?? existing.systemPrompt,
      };
      // Only update API key if provided (don't clear it accidentally)
      if (data.apiKey) updateData.apiKey = data.apiKey;

      await db
        .update(schema.agentConfig)
        .set(updateData)
        .where(eq(schema.agentConfig.userId, userId));
    } else {
      await db.insert(schema.agentConfig).values({
        userId,
        provider: data.provider,
        model: data.model,
        apiKey: data.apiKey,
        ollamaUrl: data.ollamaUrl || "http://localhost:11434",
        systemPrompt: data.systemPrompt,
      });
    }

    return c.json({ status: "updated" });
  }
);

export default config;
