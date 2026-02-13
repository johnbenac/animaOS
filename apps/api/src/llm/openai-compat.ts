// OpenAI-compatible provider — works for OpenAI, OpenRouter, and Ollama
// since they all implement the same chat completions API shape.

import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
  ProviderConfig,
  ProviderName,
} from "./types";

interface OpenAICompatibleOptions {
  name: ProviderName;
  baseUrl: string | ((config: ProviderConfig) => string);
  authHeader: (config: ProviderConfig) => Record<string, string>;
  extraHeaders?: Record<string, string>;
}

export function createOpenAICompatibleProvider(
  opts: OpenAICompatibleOptions,
): LLMProvider {
  const getBaseUrl = (config: ProviderConfig) =>
    typeof opts.baseUrl === "function" ? opts.baseUrl(config) : opts.baseUrl;

  return {
    name: opts.name,

    async chat(
      request: LLMRequest,
      config: ProviderConfig,
    ): Promise<LLMResponse> {
      const url = `${getBaseUrl(config)}/chat/completions`;
      const body: Record<string, unknown> = {
        model: config.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.max_tokens ?? 2048,
        stream: false,
      };
      if (request.tools?.length) {
        body.tools = request.tools;
        body.tool_choice = "auto";
      }

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...opts.authHeader(config),
          ...opts.extraHeaders,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`[${opts.name}] ${res.status}: ${errorText}`);
      }

      const data = (await res.json()) as {
        choices: Array<{
          message: {
            content: string | null;
            tool_calls?: LLMResponse["tool_calls"];
          };
        }>;
        model: string;
        usage?: LLMResponse["usage"];
      };

      const choice = data.choices[0];
      return {
        content: choice.message.content,
        tool_calls: choice.message.tool_calls,
        model: data.model,
        provider: opts.name,
        usage: data.usage,
      };
    },

    async *stream(
      request: LLMRequest,
      config: ProviderConfig,
    ): AsyncGenerator<LLMStreamChunk> {
      const url = `${getBaseUrl(config)}/chat/completions`;
      const body: Record<string, unknown> = {
        model: config.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.max_tokens ?? 2048,
        stream: true,
      };
      if (request.tools?.length) {
        body.tools = request.tools;
        body.tool_choice = "auto";
      }

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...opts.authHeader(config),
          ...opts.extraHeaders,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`[${opts.name}] ${res.status}: ${errorText}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const payload = trimmed.slice(6);
          if (payload === "[DONE]") {
            yield { done: true };
            return;
          }

          try {
            const parsed = JSON.parse(payload) as {
              choices: Array<{
                delta: {
                  content?: string;
                  tool_calls?: LLMStreamChunk["tool_calls"];
                };
                finish_reason: string | null;
              }>;
            };
            const delta = parsed.choices[0]?.delta;
            if (delta) {
              yield {
                content: delta.content ?? undefined,
                tool_calls: delta.tool_calls,
                done: parsed.choices[0]?.finish_reason !== null,
              };
            }
          } catch {
            // skip malformed chunks
          }
        }
      }
      yield { done: true };
    },
  };
}
