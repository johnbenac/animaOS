// Model factory — creates LangChain chat model from user config.
// Uses @langchain/openai for OpenAI, OpenRouter, and Ollama (all OpenAI-compatible).
// Uses @langchain/anthropic for Anthropic.

import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ProviderConfig, ProviderName } from "../llm/types";

export function createModel(config: ProviderConfig): BaseChatModel {
  switch (config.provider) {
    case "openai":
      return new ChatOpenAI({
        model: config.model,
        apiKey: config.apiKey,
        temperature: 0.7,
        maxTokens: 2048,
        streaming: true,
      });

    case "openrouter":
      return new ChatOpenAI({
        model: config.model,
        apiKey: config.apiKey,
        temperature: 0.7,
        maxTokens: 2048,
        streaming: true,
        configuration: {
          baseURL: "https://openrouter.ai/api/v1",
          defaultHeaders: {
            "HTTP-Referer": "https://anima.local",
            "X-Title": "ANIMA",
          },
        },
      });

    case "ollama":
      return new ChatOpenAI({
        model: config.model,
        temperature: 0.7,
        maxTokens: 2048,
        streaming: true,
        apiKey: "ollama", // required but unused
        configuration: {
          baseURL: `${config.ollamaUrl || "http://localhost:11434"}/v1`,
        },
      });

    case "anthropic":
      return new ChatAnthropic({
        model: config.model,
        apiKey: config.apiKey,
        temperature: 0.7,
        maxTokens: 2048,
        streaming: true,
      });

    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
