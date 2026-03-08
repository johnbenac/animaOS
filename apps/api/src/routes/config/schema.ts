// Zod schemas for config route validation

import { z } from "zod";

export const updateConfigSchema = z.object({
  provider: z.enum(["openrouter", "openai", "anthropic", "ollama"]),
  model: z.string().min(1),
  apiKey: z.string().optional(),
  ollamaUrl: z.string().optional(),
  systemPrompt: z.string().optional(),
});
