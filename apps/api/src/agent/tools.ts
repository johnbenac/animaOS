// Agent tools — functions the AI can call during conversation

import { eq, like } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import type { ToolDefinition } from "../llm/types";

// --- Tool definitions (sent to the LLM) ---

export const agentTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "remember",
      description:
        "Store a piece of information about the user for long-term memory. Use this when the user shares facts, preferences, goals, or important details about themselves.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The information to remember",
          },
          category: {
            type: "string",
            enum: ["fact", "preference", "goal", "relationship", "note"],
            description: "The category of memory",
          },
        },
        required: ["content", "category"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recall",
      description:
        "Search long-term memory for information about the user. Use this to retrieve previously stored facts, preferences, or context.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query to find relevant memories",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_profile",
      description:
        "Get the user's profile information including name, age, gender, birthday.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_memories",
      description:
        "List all stored memories for the user, optionally filtered by category.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["fact", "preference", "goal", "relationship", "note"],
            description: "Optional category filter",
          },
        },
      },
    },
  },
];

// --- Tool execution ---

type ToolArgs = Record<string, unknown>;

export async function executeTool(
  name: string,
  args: ToolArgs,
  userId: number,
): Promise<string> {
  switch (name) {
    case "remember":
      return await toolRemember(
        args.content as string,
        args.category as string,
        userId,
      );
    case "recall":
      return await toolRecall(args.query as string, userId);
    case "get_profile":
      return await toolGetProfile(userId);
    case "list_memories":
      return await toolListMemories(
        userId,
        args.category as string | undefined,
      );
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

async function toolRemember(
  content: string,
  category: string,
  userId: number,
): Promise<string> {
  await db.insert(schema.memories).values({
    userId,
    content,
    category,
    source: "conversation",
  });
  return JSON.stringify({ status: "stored", content, category });
}

async function toolRecall(query: string, userId: number): Promise<string> {
  // Simple keyword search — can upgrade to vector search later
  const results = await db
    .select()
    .from(schema.memories)
    .where(eq(schema.memories.userId, userId));

  const queryLower = query.toLowerCase();
  const matched = results.filter((m) =>
    m.content.toLowerCase().includes(queryLower),
  );

  if (matched.length === 0) {
    return JSON.stringify({
      results: [],
      message: "No matching memories found",
    });
  }
  return JSON.stringify({
    results: matched.map((m) => ({
      content: m.content,
      category: m.category,
      created: m.createdAt,
    })),
  });
}

async function toolGetProfile(userId: number): Promise<string> {
  const [user] = await db
    .select({
      name: schema.users.name,
      gender: schema.users.gender,
      age: schema.users.age,
      birthday: schema.users.birthday,
      username: schema.users.username,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId));

  if (!user) return JSON.stringify({ error: "User not found" });
  return JSON.stringify(user);
}

async function toolListMemories(
  userId: number,
  category?: string,
): Promise<string> {
  let query = db
    .select()
    .from(schema.memories)
    .where(eq(schema.memories.userId, userId));

  const results = await query;
  const filtered = category
    ? results.filter((m) => m.category === category)
    : results;

  return JSON.stringify({
    count: filtered.length,
    memories: filtered.map((m) => ({
      id: m.id,
      content: m.content,
      category: m.category,
      source: m.source,
      created: m.createdAt,
    })),
  });
}
