import { createAgent, createMiddleware } from "langchain";
import { SystemMessage, trimMessages } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { ProviderConfig } from "../llm/types";
import { createModel } from "./models";
import { createTools } from "./tools.langchain";
import { langGraphCheckpointer } from "./checkpointer";

// ── Windowing / summarization constants ──────────────────────────

/** Approximate token count — 1 token ≈ 4 chars. Good enough for windowing. */
export function approxTokenCount(msgs: BaseMessage[]): number {
  let chars = 0;
  for (const m of msgs) {
    chars +=
      typeof m.content === "string"
        ? m.content.length
        : JSON.stringify(m.content).length;
  }
  return Math.ceil(chars / 4);
}

/** Max tokens to keep in the message window sent to the LLM. */
export const MAX_WINDOW_TOKENS = 12_000;

/** Number of recent messages to always preserve when summarizing. */
export const KEEP_RECENT_MESSAGES = 4;

/** Trigger summarization when checkpoint messages exceed this count. */
export const SUMMARIZE_THRESHOLD = 40;

// ── Agent graph factory ──────────────────────────────────────────

/**
 * Build a fresh LangGraph agent (model + tools + middleware).
 * Call via the cache layer in `cache.ts` instead of directly.
 */
export function buildAgent(
  config: ProviderConfig,
  userId: number,
  fullSystemPrompt: string,
) {
  const model = createModel(config);
  const tools = createTools(userId);

  // Middleware that trims the message window before each LLM call
  // so long-lived conversations don't blow up the context window.
  const messageWindowMiddleware = createMiddleware({
    name: "MessageWindow",
    wrapModelCall: async (request, handler) => {
      const trimmed = await trimMessages(request.messages, {
        maxTokens: MAX_WINDOW_TOKENS,
        tokenCounter: approxTokenCount,
        strategy: "last",
        startOn: "human",
        includeSystem: true,
        allowPartial: false,
      });
      return handler({ ...request, messages: trimmed });
    },
  });

  return createAgent({
    model,
    tools,
    systemPrompt: new SystemMessage(fullSystemPrompt),
    middleware: [messageWindowMiddleware],
    checkpointer: langGraphCheckpointer,
  });
}
