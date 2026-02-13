// Anthropic provider — uses the Messages API (not OpenAI-compatible)

import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
  ProviderConfig,
  ChatMessage,
  ToolDefinition,
} from "./types";

const BASE_URL = "https://api.anthropic.com/v1";
const API_VERSION = "2023-06-01";

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

function convertTools(tools: ToolDefinition[]): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

function buildAnthropicMessages(messages: ChatMessage[]) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");

  const nonSystem = messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (m.role === "tool") {
        return {
          role: "user" as const,
          content: [
            {
              type: "tool_result" as const,
              tool_use_id: m.tool_call_id,
              content: m.content,
            },
          ],
        };
      }
      if (m.tool_calls?.length) {
        return {
          role: "assistant" as const,
          content: m.tool_calls.map((tc) => ({
            type: "tool_use" as const,
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments),
          })),
        };
      }
      return { role: m.role as "user" | "assistant", content: m.content };
    });

  return { system: system || undefined, messages: nonSystem };
}

export const anthropicProvider: LLMProvider = {
  name: "anthropic",

  async chat(
    request: LLMRequest,
    config: ProviderConfig,
  ): Promise<LLMResponse> {
    if (!config.apiKey) throw new Error("[anthropic] API key required");

    const { system, messages } = buildAnthropicMessages(request.messages);
    const body: Record<string, unknown> = {
      model: config.model,
      messages,
      max_tokens: request.max_tokens ?? 2048,
      temperature: request.temperature ?? 0.7,
    };
    if (system) body.system = system;
    if (request.tools?.length) body.tools = convertTools(request.tools);

    const res = await fetch(`${BASE_URL}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`[anthropic] ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as {
      content: Array<
        | { type: "text"; text: string }
        | { type: "tool_use"; id: string; name: string; input: unknown }
      >;
      model: string;
      usage: { input_tokens: number; output_tokens: number };
    };

    let content: string | null = null;
    const toolCalls: LLMResponse["tool_calls"] = [];

    for (const block of data.content) {
      if (block.type === "text") {
        content = (content || "") + block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          type: "function",
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        });
      }
    }

    return {
      content,
      tool_calls: toolCalls.length ? toolCalls : undefined,
      model: data.model,
      provider: "anthropic",
      usage: {
        prompt_tokens: data.usage.input_tokens,
        completion_tokens: data.usage.output_tokens,
        total_tokens: data.usage.input_tokens + data.usage.output_tokens,
      },
    };
  },

  async *stream(
    request: LLMRequest,
    config: ProviderConfig,
  ): AsyncGenerator<LLMStreamChunk> {
    if (!config.apiKey) throw new Error("[anthropic] API key required");

    const { system, messages } = buildAnthropicMessages(request.messages);
    const body: Record<string, unknown> = {
      model: config.model,
      messages,
      max_tokens: request.max_tokens ?? 2048,
      temperature: request.temperature ?? 0.7,
      stream: true,
    };
    if (system) body.system = system;
    if (request.tools?.length) body.tools = convertTools(request.tools);

    const res = await fetch(`${BASE_URL}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`[anthropic] ${res.status}: ${errText}`);
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
        if (!trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);

        try {
          const event = JSON.parse(payload) as {
            type: string;
            delta?: { type: string; text?: string };
          };

          if (event.type === "content_block_delta" && event.delta?.text) {
            yield { content: event.delta.text, done: false };
          } else if (event.type === "message_stop") {
            yield { done: true };
            return;
          }
        } catch {
          // skip
        }
      }
    }
    yield { done: true };
  },
};
