# Memory Index

## Project Architecture
- Python server: `apps/server/src/anima_server/services/agent/` — runtime.py, consolidation.py, memory_store.py, memory_blocks.py, compaction.py
- Research docs: `.local-docs/SYNTHESIS.md` (master reference), `.local-docs/memory-improvement-plan.md` (7-phase plan for TS API), `.local-docs/memory-research-findings.md` (industry comparison)
- Letta reference: `.local-docs/docs/letta/MEMORY_SYSTEM.md`, `ARCHITECTURE.md`, `AGENT_ORCHESTRATION.md`
- Legacy TS API: `apps/api/` — has full memory system but being superseded by Python server

## Current Python Server Memory State (2026-03-14)
- Extraction: regex-only (no LLM), ~5 fact patterns + ~3 preference patterns + current focus
- Storage: flat markdown files under `memory/user/` (facts.md, preferences.md, current-focus.md) + daily logs
- Context: 3 memory blocks (human from DB profile, current_focus from file, thread_summary from compaction)
- Facts/preferences from files are NOT injected into prompts — only DB profile fields
- Compaction: token-triggered, non-LLM summary (truncated message snippets), marks old messages out-of-context
- Background: fire-and-forget asyncio task after each turn for regex extraction + daily log append
- No: LLM extraction, conflict resolution, importance scoring, episodic memory, vector search, session scoping, procedural memory, sleep-time agent

## Key Design Principle
- SYNTHESIS.md "Five Streams of Consciousness" is the north-star architecture
- Research plan targets 3 waves: Truthful Memory, Consciousness Layer, Depth
- The 7-phase plan in memory-improvement-plan.md was written for the TS API — needs adaptation for Python server
