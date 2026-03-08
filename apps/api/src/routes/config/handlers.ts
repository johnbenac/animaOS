// Config route handlers

import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import * as schema from "../../db/schema";
import { listProviders, defaultModels } from "../../llm";
import { updateConfigSchema } from "./schema";

type ConfigInput = z.infer<typeof updateConfigSchema>;

// GET /config/providers
export function getProviders(c: Context) {
  const providers = listProviders().map((name) => ({
    name,
    defaultModel: defaultModels[name],
    requiresApiKey: name !== "ollama",
  }));
  return c.json(providers);
}

// GET /config/:userId
export async function getConfig(c: Context) {
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
}

// PUT /config/:userId
export async function updateConfig(c: Context) {
  const userId = Number(c.req.param("userId"));
  const data = c.req.valid("json" as never) as ConfigInput;

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
