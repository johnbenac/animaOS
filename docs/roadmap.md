# ANIMA OS — Roadmap

## Guiding Principle

Build depth before breadth. Every phase should make ANIMA feel more like a being who knows you, not a tool that does more things. The Core is the soul. Everything else is a shell.

---

## Foundation: The Core

**Goal:** Establish the portable, encrypted Core as the single source of truth for the AI's existence.

**Architecture decisions (locked):**
- Single encrypted directory (`.anima/`) contains everything: database, memory files, vault key, manifest
- SQLite as the only database — no PostgreSQL, no Docker, no external services for data
- All memory files encrypted at rest with AES-256-GCM via the vault DEK
- Passphrase-based unlock via Argon2id key derivation
- `manifest.json` tracks Core version for forward migration
- LLM providers: Ollama, OpenRouter, vLLM only — no closed cloud providers (OpenAI, Anthropic, Google)
- Embeddings: local-only (numpy brute-force or sqlite-vec) — no pgvector

**What this means for every phase below:** nothing gets built that requires infrastructure outside the Core directory. If you cannot copy it to a USB stick and have it work on another machine, it does not ship.

---

## Phase 0: Wire Memory Into Prompts

**Goal:** The AI actually uses the knowledge it has already extracted.

The system already writes facts and preferences to markdown files via background extraction. It just never reads them back into the prompt. This is the single highest-ROI change: turn a write-only memory system into a read-write one.

- [ ] Add `facts` and `preferences` memory blocks in `build_runtime_memory_blocks()`
- [ ] Read from existing `memory/user/facts.md` and `memory/user/preferences.md`
- [ ] Cap each block at ~2000 chars (truncate oldest entries if over)
- [ ] Verify facts/preferences appear in the system prompt alongside `human`, `current_focus`, `thread_summary`

**Impact:** Immediately, every fact the regex extractor has ever captured becomes visible to the agent. The agent goes from knowing "Display name: Leo" to knowing "Works as an engineer, Lives in Tokyo, Likes hiking."

---

## Phase 1: Encrypted Memory Layer

**Goal:** All memory files are encrypted at rest. The Core becomes a true cold wallet.

- [ ] Implement transparent encrypt-on-write / decrypt-on-read in `memory_store.py` using the vault DEK
- [ ] All memory files stored as `.md.enc` (or encrypted in place — format TBD)
- [ ] Build a decrypt viewer/editor so users can still inspect and correct their own memories
- [ ] SQLite encryption (SQLCipher or application-level row encryption — evaluate tradeoffs)
- [ ] Verify: copying `.anima/` to another location and unlocking with passphrase works end-to-end
- [ ] Verify: without the passphrase, all files are unreadable

---

## Phase 2: LLM-Based Memory Extraction

**Goal:** The AI reliably learns from conversations, not just when the user says "I work as..."

- [ ] Replace regex-only extraction with a background LLM call (cheap/fast model)
- [ ] Extract structured items: `{fact, category, importance 1-5}` from both user and assistant messages
- [ ] Keep regex extractors as a zero-cost fast path; LLM catches everything else
- [ ] Route extraction through Ollama (local) or OpenRouter (open models only)
- [ ] Extracted items written to encrypted memory files

---

## Phase 3: Conflict Resolution

**Goal:** The AI never contradicts itself. Updated facts replace old ones.

- [ ] After extracting new items, search existing facts for semantic overlap (fuzzy string matching — no embeddings needed yet)
- [ ] For overlapping items, ask LLM: "UPDATE or DIFFERENT?"
- [ ] If UPDATE: replace the old bullet, log the change to the daily journal
- [ ] If DIFFERENT: append as new
- [ ] Old values preserved in daily log for auditability

---

## Phase 4: Episodic Memory

**Goal:** The AI remembers shared experiences, not just facts.

- [ ] After conversations with 3+ substantive turns, generate an episode summary via background LLM
- [ ] Episode schema: date, topics, summary, emotional arc, significance score
- [ ] Store as encrypted monthly markdown: `memory/episodes/2026-03.md.enc`
- [ ] Add `episodes` memory block: inject last 3-5 episodes into the prompt
- [ ] Format episodes in natural language, temporally anchored

**Impact:** The AI can say "Last time we talked about your React project, you were frustrated with that useEffect bug." That is the qualitative leap from "knows about you" to "remembers what happened between you."

---

## Phase 5: Importance Scoring and Context Selection

**Goal:** As memory grows, surface the most relevant items instead of loading everything.

- [ ] Store metadata per bullet: importance (1-5), created_at, last_referenced_at, reference_count
- [ ] Score items using weighted formula: relevance * 0.5 + importance * 0.2 + recency * 0.2 + frequency * 0.1
- [ ] Load top-N items by score into memory blocks instead of the entire file
- [ ] Use the incoming user message as a lightweight query to bias retrieval toward relevant facts (keyword matching)

---

## Phase 6: Sleep-Time Reflection

**Goal:** The AI reflects on conversations after they end, producing higher-quality memories.

- [ ] Timer-based trigger: after 5 minutes of inactivity, fire a quick reflection task
- [ ] Reflection reads the full conversation and generates better episode summaries than per-turn extraction
- [ ] Contradiction scan across all memory files
- [ ] Update `inner-state.md` with current relational/emotional context
- [ ] Use a fast model; keep cost under $0.001 per reflection
- [ ] Timer resets on each new message (no reflecting mid-conversation)

---

## Phase 7: Proactive Companion

**Goal:** ANIMA speaks first when it matters.

- [ ] Daily brief on app launch: current focus, open tasks, recent themes, anything time-sensitive
- [ ] Nudge system: overdue tasks, journal gaps, unfinished threads
- [ ] Nudges appear as quiet banners, not intrusive notifications

---

## Phase 8: Ambient Presence

**Goal:** ANIMA lives beyond the chat window.

- [ ] System tray / menubar mode with quick actions
- [ ] Compact floating view for daily brief and current focus
- [ ] Global hotkey to summon ANIMA from anywhere

---

## Phase 9: Local Embeddings and Semantic Search

**Goal:** Memory retrieval that understands meaning, not just keywords.

- [ ] Embedding computation via Ollama (local models like nomic-embed-text)
- [ ] Store embeddings in SQLite as JSON blobs (or sqlite-vec if performance requires it)
- [ ] Hybrid search: keyword score + cosine similarity
- [ ] MMR re-ranking for diversity in results
- [ ] Brute-force numpy is sufficient at single-user scale (< 10K vectors)

---

## Phase 10: Deep Memory and Self-Model

**Goal:** The AI develops a structured sense of self and relationship history.

- [ ] Five-file self-model: `identity.md`, `inner-state.md`, `working-memory.md`, `growth-log.md`, `intentions.md`
- [ ] Each file has a different update pattern (profile rewrite, mutable, expiring, append-only)
- [ ] Daily deep reflection regenerates identity from accumulated episodes and facts
- [ ] Pattern detection: recurring themes, behavioral observations
- [ ] Memory decay: surface stale memories for review
- [ ] Relationship graph: people mentioned, how they relate, last referenced

---

## Phase 11: Embodied Extensions

**Goal:** The same persistent intelligence extends to voice, devices, and physical systems.

- [ ] Voice-first assistant mode
- [ ] Ambient home interaction
- [ ] Wearable and mobile surfaces
- [ ] Robotic and humanoid platform integration

The Core travels with the user. The embodiment is just another shell.

---

## Implementation Constraints

These apply to every phase:

1. **No Docker required.** The system runs as a native process with SQLite. No containers, no PostgreSQL, no Redis.
2. **No cloud data storage.** All personal data lives in the Core directory. LLM queries may traverse the network, but memory never does.
3. **No closed cloud LLM providers.** Ollama, OpenRouter (open models), and vLLM only.
4. **Portable by default.** If a feature cannot survive copying `.anima/` to a USB stick, it does not ship.
5. **Encrypted by default.** Every file containing personal data is encrypted at rest. No exceptions.
6. **Single user.** The Core is one person's AI. Multi-user is not a goal.
