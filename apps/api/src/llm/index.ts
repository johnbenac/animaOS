// Unified LLM provider registry
// OpenAI, OpenRouter, and Ollama all use the OpenAI-compatible API shape.
// Anthropic has its own Messages API — handled separately.

import { createOpenAICompatibleProvider } from "./openai-compat";
import { anthropicProvider } from "./anthropic";
import type { LLMProvider, ProviderName, ProviderConfig } from "./types";

// --- Provider instances ---

const openaiProvider = createOpenAICompatibleProvider({
  name: "openai",
  baseUrl: "https://api.openai.com/v1",
  authHeader: (c) => ({ Authorization: `Bearer ${c.apiKey}` }),
});

const openrouterProvider = createOpenAICompatibleProvider({
  name: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  authHeader: (c) => ({ Authorization: `Bearer ${c.apiKey}` }),
  extraHeaders: { "HTTP-Referer": "https://anima.local", "X-Title": "ANIMA" },
});

const ollamaProvider = createOpenAICompatibleProvider({
  name: "ollama",
  baseUrl: (c) => `${c.ollamaUrl || "http://localhost:11434"}/v1`,
  authHeader: () => ({}), // no auth needed
});

// --- Registry ---

const providers: Record<ProviderName, LLMProvider> = {
  openai: openaiProvider,
  openrouter: openrouterProvider,
  anthropic: anthropicProvider,
  ollama: ollamaProvider,
};

export function getProvider(name: ProviderName): LLMProvider {
  const p = providers[name];
  if (!p) throw new Error(`Unknown provider: ${name}`);
  return p;
}

export function listProviders(): ProviderName[] {
  return Object.keys(providers) as ProviderName[];
}

// Default models per provider
export const defaultModels: Record<ProviderName, string> = {
  ollama: "qwen3:14b",
  openai: "gpt-4o-mini",
  openrouter: "anthropic/claude-sonnet-4-20250514",
  anthropic: "claude-sonnet-4-20250514",
};

export type { LLMProvider, ProviderName, ProviderConfig };
export * from "./types";
