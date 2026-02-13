// Agent runner — lightweight abstraction for single and multi-agent execution.
// Today: runs one agent (chat). Tomorrow: dispatcher for specialized agents.
//
// This is NOT a framework. It's a ~50 line pattern that lets you add agents
// without touching existing code.

import type { ChatMessage, ToolDefinition, ProviderConfig } from "../llm/types";

// --- Agent interface ---
// Every agent implements this. Today there's one. Later: memory, planner, action, etc.

export interface Agent {
  name: string;
  description: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  executeTool: (
    name: string,
    args: Record<string, unknown>,
    userId: number,
  ) => Promise<string>;
}

// --- Agent context ---
// Shared state passed between agents in an orchestration chain.

export interface AgentContext {
  userId: number;
  messages: ChatMessage[];
  config: ProviderConfig;
  results: Record<string, string>; // outputs from previous agents in a chain
  toolsUsed: string[];
}

// --- Agent registry ---

const agents = new Map<string, Agent>();

export function registerAgent(agent: Agent) {
  agents.set(agent.name, agent);
}

export function getAgent(name: string): Agent {
  const agent = agents.get(name);
  if (!agent) throw new Error(`Agent not found: ${name}`);
  return agent;
}

export function listAgents(): string[] {
  return Array.from(agents.keys());
}

// --- Pipeline (future use) ---
// Run multiple agents in sequence. Each agent gets the previous agent's output.
// Not used today — here so the pattern exists when you need it.

export async function runPipeline(
  agentNames: string[],
  context: AgentContext,
  runner: (agent: Agent, context: AgentContext) => Promise<string>,
): Promise<AgentContext> {
  for (const name of agentNames) {
    const agent = getAgent(name);
    const result = await runner(agent, context);
    context.results[name] = result;
  }
  return context;
}
