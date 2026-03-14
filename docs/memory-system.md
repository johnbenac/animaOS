# ANIMA Memory System

> Status: implemented
> Last updated: 2026-03-14

## Overview

ANIMA's structured long-term memory now lives primarily in SQLite tables inside
the server Core. `soul.md` is no longer the primary storage path; the live soul
directive now lives in `self_model_blocks` with `section="soul"`, and legacy
file-backed souls are migrated into the database on first read.

Current storage split:

- `memory_items`: durable facts, preferences, goals, relationships, and focus
- `memory_episodes`: summarized shared experiences
- `memory_daily_logs`: per-turn logs used for reflection and episode generation
- `session_notes`: session-scoped working memory the agent can write during a thread
- `self_model_blocks`: soul directive plus the five evolving self-model sections

## Identity Layers

The runtime currently uses three identity layers, and they should be understood
as separate:

- `persona`: a thin static seed from the persona template
- `soul`: the user-authored charter for who ANIMA should be in this
  relationship
- `self_identity`: the evolving self-understanding learned over time

These are not duplicates.

Recommended interpretation:

- `persona` provides safe default voice and baseline temperament
- `soul` is the canonical user-specific identity directive
- `self_identity` is the adaptive internal layer that changes as the
  relationship deepens

In the current prompt system, `self_identity` is promoted into the system prompt
as dynamic identity while the remaining self-model sections stay as structured
memory context.

## Runtime Flow

```text
User message
  |
  v
Agent runtime
  - loads prompt memory blocks from the database
  - loads soul and self-model sections
  - loads session notes for the current thread
  - loads thread summary and recent episodes
  |
  v
Assistant response returned to the user
  |
  +--> background consolidation
  |     - write daily log
  |     - regex extraction
  |     - optional LLM extraction
  |     - conflict resolution
  |     - embedding backfill
  |
  +--> reflection after inactivity
        - contradiction scan
        - profile synthesis
        - episode generation
```

## Data Model

### `memory_items`

Long-term structured memory.

Categories currently used:

- `fact`
- `preference`
- `goal`
- `relationship`
- `focus`

Important fields:

| Column | Purpose |
|---|---|
| `content` | Canonical memory statement |
| `importance` | 1-5 strength score |
| `source` | `extraction`, `user`, or `reflection` |
| `superseded_by` | Replaced memory item id, if any |
| `reference_count` | Prompt retrieval counter |
| `last_referenced_at` | Last retrieval timestamp |
| `embedding_json` | Portable embedding payload stored in SQLite |

### `memory_episodes`

Episode summaries generated from conversation history.

Important fields:

| Column | Purpose |
|---|---|
| `date` / `time` | Episode anchor |
| `topics_json` | Topic labels |
| `summary` | Natural-language episode summary |
| `emotional_arc` | Emotional movement across the episode |
| `significance_score` | Relative importance |
| `turn_count` | Number of turns represented |

### `memory_daily_logs`

Per-turn capture used for later reflection work.

| Column | Purpose |
|---|---|
| `date` | Day bucket |
| `user_message` | Raw user message |
| `assistant_response` | Raw assistant reply |

### `session_notes`

Thread-scoped working memory written through tools such as `note_to_self`.

These notes persist within the thread but are not treated as durable identity
memory until promoted into `memory_items`.

### `self_model_blocks`

Database-backed identity and consciousness state.

Current sections used by the runtime:

- `soul`
- `identity`
- `inner_state`
- `working_memory`
- `growth_log`
- `intentions`

## Prompt Memory Blocks

The runtime builds prompt context from these sources in
`apps/server/src/anima_server/services/agent/memory_blocks.py`:

- `soul`
- `self_identity` (lifted into the system prompt as dynamic identity)
- `self_inner_state`
- `self_working_memory`
- `self_growth_log`
- `self_intentions`
- `emotional_context`
- `human`
- `relevant_memories`
- `facts`
- `preferences`
- `goals`
- `relationships`
- `current_focus`
- `thread_summary`
- `recent_episodes`
- `session_memory`

`facts`, `preferences`, `goals`, and `relationships` are ranked with a retrieval
score that combines importance, recency, and access frequency before they are
injected into the prompt. Semantic search can also inject query-relevant
memories as a dedicated block.

## Key Files

| File | Purpose |
|---|---|
| `apps/server/src/anima_server/services/agent/memory_store.py` | CRUD, scoring, dedupe, supersession |
| `apps/server/src/anima_server/services/agent/memory_blocks.py` | Prompt block construction |
| `apps/server/src/anima_server/services/agent/self_model.py` | Self-model section storage, seeding, rendering, expiry |
| `apps/server/src/anima_server/services/agent/consolidation.py` | Regex extraction, LLM extraction, conflict checks |
| `apps/server/src/anima_server/services/agent/episodes.py` | Episodic memory generation |
| `apps/server/src/anima_server/services/agent/reflection.py` | Inactivity-triggered reflection entrypoint |
| `apps/server/src/anima_server/services/agent/sleep_tasks.py` | Contradiction scan, synthesis, reflection jobs |
| `apps/server/src/anima_server/api/routes/memory.py` | Memory CRUD and search API |
| `apps/server/src/anima_server/api/routes/soul.py` | Database-backed soul read/write path with legacy file migration |

## API Endpoints

Structured memory routes:

- `GET /api/memory/{user_id}`
- `GET /api/memory/{user_id}/items`
- `POST /api/memory/{user_id}/items`
- `PUT /api/memory/{user_id}/items/{item_id}`
- `DELETE /api/memory/{user_id}/items/{item_id}`
- `GET /api/memory/{user_id}/search`
- `GET /api/memory/{user_id}/episodes`

Separate soul route:

- `GET /api/soul/{user_id}`
- `PUT /api/soul/{user_id}`

## Search and Embeddings

Structured memory search supports:

- keyword search directly from SQLite
- semantic search via generated embeddings
- a process-local in-memory vector index for faster lookup

Embeddings are also mirrored into `memory_items.embedding_json` so vault export
and import do not depend on a separate persisted vector-store directory.

## Encryption

Current at-rest behavior is mixed:

- The SQLite database can be encrypted with SQLCipher when
  `ANIMA_CORE_PASSPHRASE` is set and `sqlcipher3` is installed.
- If no passphrase is configured, or `sqlcipher3` is unavailable, the database
  falls back to plain SQLite.
- The live soul directive is stored in the database. Legacy `soul.md` files are
  migrated into the database on first successful read and then removed.
- `manifest.json` remains plaintext metadata.

So the memory system is already local-first and mostly database-backed, but the
Core is not yet fully encrypted by default.
