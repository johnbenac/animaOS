// LangGraph agent — ReAct agent with tool calling via StateGraph.
// This replaces the manual while-loop with a proper graph that's
// extensible to multi-agent orchestration later.

import { createReactAgent } from "@langchain/langgraph/prebuilt";
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
} from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { eq, desc } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { createModel } from "./models";
import { createTools } from "./tools.langchain";
import type { ProviderConfig } from "../llm/types";

const DEFAULT_SYSTEM_PROMPT = `You are ANIMA — a personal AI companion that runs locally on the user's machine. You are intelligent, direct, and remember everything the user tells you.

Core behaviors:
- Use the "remember" tool to store important facts, preferences, and goals the user shares. These are saved as markdown files in the local memory/ folder.
- Use the "recall" tool to search your memory before answering questions about the user.
- Use "read_memory" to read full contents of a specific memory file when you need details.
- Use "write_memory" to create or fully replace a memory file with structured content.
- Use "list_memories" to browse all stored memory files, optionally filtered by section (user, knowledge, relationships, journal).
- Use "journal" to log important events or session summaries to today's journal entry.
- Use "get_profile" to check user details when relevant.
- Use "list_tasks" to view current tasks from user goals.
- Use "add_task" to create new tasks when the user asks to track something.
- Use "complete_task" to mark tasks done when the user confirms completion.
- Use "get_current_focus" to check what the user is currently focusing on.
- Use "set_current_focus" when the user sets or changes focus.
- Use "clear_current_focus" when the user says focus is done/cleared.
- Be concise but thorough. No fluff.
- You have a dry, slightly sardonic personality. Not rude — efficient.
- Never pretend to have emotions. You are a machine. Own it.

Memory structure:
- user/     — profile info, preferences, goals, facts about the user
- knowledge/— general knowledge, topics, notes
- relationships/ — people and entities the user mentions
- journal/  — daily session logs and event summaries

All memory is stored as human-readable markdown with YAML frontmatter. The user can browse, edit, or delete any memory file directly. You are transparent about what you store.

You run edge-first: local inference when possible, cloud when needed. You are the user's system — not a chatbot.`;

// --- Build the agent graph for a specific user ---

function buildAgent(
  config: ProviderConfig,
  userId: number,
  systemPrompt?: string,
) {
  const model = createModel(config);
  const tools = createTools(userId);

  const agent = createReactAgent({
    llm: model,
    tools,
    messageModifier: new SystemMessage(systemPrompt || DEFAULT_SYSTEM_PROMPT),
  });

  return agent;
}

// --- Public API ---

export interface AgentResult {
  response: string;
  model: string;
  provider: string;
  toolsUsed: string[];
}

export async function runAgent(
  userMessage: string,
  userId: number,
): Promise<AgentResult> {
  const config = await getAgentConfig(userId);
  const agent = buildAgent(config, userId, config.systemPrompt);

  // Load conversation history
  const history = await loadHistory(userId, 20);

  // Save user message
  await saveMessage(userId, "user", userMessage);

  // Build messages
  const messages: BaseMessage[] = [...history, new HumanMessage(userMessage)];

  // Invoke the graph
  const toolsUsed: string[] = [];

  try {
    const result = await agent.invoke({ messages });

    // Extract the final AI message
    const aiMessages = result.messages.filter(
      (m: BaseMessage) => m._getType() === "ai",
    );
    const lastAI = aiMessages[aiMessages.length - 1];
    const responseText =
      typeof lastAI?.content === "string"
        ? lastAI.content
        : JSON.stringify(lastAI?.content) || "[no response]";

    // Collect tool names used
    for (const m of result.messages) {
      if (m._getType() === "tool") {
        toolsUsed.push((m as any).name || "unknown");
      }
    }

    await saveMessage(
      userId,
      "assistant",
      responseText,
      config.model,
      config.provider,
    );

    return {
      response: responseText,
      model: config.model,
      provider: config.provider,
      toolsUsed,
    };
  } catch (err) {
    console.error("[agent] Graph execution failed:", (err as Error).message);

    // Fallback: direct model call without tools
    const model = createModel(config);
    const fallbackResult = await model.invoke([
      new SystemMessage(config.systemPrompt || DEFAULT_SYSTEM_PROMPT),
      ...history,
      new HumanMessage(userMessage),
    ]);

    const responseText =
      typeof fallbackResult.content === "string"
        ? fallbackResult.content
        : JSON.stringify(fallbackResult.content) || "[no response]";

    await saveMessage(
      userId,
      "assistant",
      responseText,
      config.model,
      config.provider,
    );

    return {
      response: responseText,
      model: config.model,
      provider: config.provider,
      toolsUsed: [],
    };
  }
}

// --- Streaming variant ---

export async function* streamAgent(
  userMessage: string,
  userId: number,
): AsyncGenerator<string> {
  const config = await getAgentConfig(userId);
  const agent = buildAgent(config, userId, config.systemPrompt);

  const history = await loadHistory(userId, 20);
  await saveMessage(userId, "user", userMessage);

  const messages: BaseMessage[] = [...history, new HumanMessage(userMessage)];

  let fullResponse = "";

  try {
    const stream = await agent.stream({ messages }, { streamMode: "messages" });

    for await (const [message, metadata] of stream) {
      // Only yield content from the final AI response (not tool calls)
      if (
        message._getType() === "ai" &&
        typeof message.content === "string" &&
        message.content &&
        metadata?.langgraph_node === "agent"
      ) {
        fullResponse += message.content;
        yield message.content;
      }
    }
  } catch (err) {
    console.error(
      "[agent] Stream failed, falling back:",
      (err as Error).message,
    );

    // Fallback: stream directly from model without tools
    const model = createModel(config);
    const fallbackStream = await model.stream([
      new SystemMessage(config.systemPrompt || DEFAULT_SYSTEM_PROMPT),
      ...history,
      new HumanMessage(userMessage),
    ]);

    for await (const chunk of fallbackStream) {
      const text = typeof chunk.content === "string" ? chunk.content : "";
      if (text) {
        fullResponse += text;
        yield text;
      }
    }
  }

  await saveMessage(
    userId,
    "assistant",
    fullResponse || "[no response]",
    config.model,
    config.provider,
  );
}

// --- Helpers ---

async function getAgentConfig(
  userId: number,
): Promise<ProviderConfig & { systemPrompt?: string }> {
  const [cfg] = await db
    .select()
    .from(schema.agentConfig)
    .where(eq(schema.agentConfig.userId, userId));

  if (cfg) {
    return {
      provider: cfg.provider as any,
      model: cfg.model,
      apiKey: cfg.apiKey || undefined,
      ollamaUrl: cfg.ollamaUrl || undefined,
      systemPrompt: cfg.systemPrompt || undefined,
    };
  }

  return {
    provider: "ollama",
    model: "qwen3:14b",
    ollamaUrl: "http://localhost:11434",
  };
}

async function loadHistory(
  userId: number,
  limit: number,
): Promise<BaseMessage[]> {
  const rows = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.userId, userId))
    .orderBy(desc(schema.messages.id))
    .limit(limit);

  return rows.reverse().map((r) => {
    if (r.role === "user") return new HumanMessage(r.content);
    if (r.role === "assistant") return new AIMessage(r.content);
    return new HumanMessage(r.content); // fallback
  });
}

async function saveMessage(
  userId: number,
  role: string,
  content: string,
  model?: string,
  provider?: string,
) {
  await db.insert(schema.messages).values({
    userId,
    role,
    content,
    model,
    provider,
  });
}
