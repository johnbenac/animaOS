// Unified LLM types across all providers

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLMRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface LLMResponse {
  content: string | null;
  tool_calls?: ToolCall[];
  model: string;
  provider: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface LLMStreamChunk {
  content?: string;
  tool_calls?: Partial<ToolCall>[];
  done: boolean;
}

export type ProviderName = "openrouter" | "openai" | "anthropic" | "ollama";

export interface ProviderConfig {
  provider: ProviderName;
  model: string;
  apiKey?: string;
  ollamaUrl?: string;
}

export interface LLMProvider {
  name: ProviderName;
  chat(request: LLMRequest, config: ProviderConfig): Promise<LLMResponse>;
  stream(
    request: LLMRequest,
    config: ProviderConfig,
  ): AsyncGenerator<LLMStreamChunk>;
}
