// Agent entry point — exports from the LangGraph-based agent.
// The old manual while-loop is replaced by a proper StateGraph (graph.ts).
// Old files (tools.ts, runner.ts) kept for reference but no longer active.

export { runAgent, streamAgent } from "./graph";
export type { AgentResult } from "./graph";
