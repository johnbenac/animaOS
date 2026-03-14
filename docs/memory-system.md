# ANIMA Memory System

> Status: implemented
> Last updated: 2026-03-14

## Overview

ANIMA's structured long-term memory now lives primarily in SQLite tables inside
the server Core. The main exception is `users/<user_id>/soul.md`, which is still
a separate per-user file and is encrypted on write.

Current storage split:

- `memory_items`: durable facts, preferences, goals, relationships, and focus
- `memory_episodes`: summarized shared experiences
- `memory_daily_logs`: per-turn logs used for reflection and episode generation
- `session_notes`: session-scoped working memory the agent can write during a thread
- `users/<user_id>/soul.md`: separate persona and identity document, file-backed

## Runtime Flow

```text
User message
  |
  v
Agent runtime
  - loads prompt memory blocks from the database
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

## Prompt Memory Blocks

The runtime builds prompt context from these sources in
`apps/server/src/anima_server/services/agent/memory_blocks.py`:

- `human`
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
injected into the prompt.

## Key Files

| File | Purpose |
|---|---|
| `apps/server/src/anima_server/services/agent/memory_store.py` | CRUD, scoring, dedupe, supersession |
| `apps/server/src/anima_server/services/agent/memory_blocks.py` | Prompt block construction |
| `apps/server/src/anima_server/services/agent/consolidation.py` | Regex extraction, LLM extraction, conflict checks |
| `apps/server/src/anima_server/services/agent/episodes.py` | Episodic memory generation |
| `apps/server/src/anima_server/services/agent/reflection.py` | Inactivity-triggered reflection entrypoint |
| `apps/server/src/anima_server/services/agent/sleep_tasks.py` | Contradiction scan, synthesis, reflection jobs |
| `apps/server/src/anima_server/api/routes/memory.py` | Memory CRUD and search API |
| `apps/server/src/anima_server/api/routes/soul.py` | File-backed `soul.md` read/write path |

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
- `users/<user_id>/soul.md` is encrypted on write with the user's DEK and
  legacy plaintext files are rewritten on first successful read.
- `manifest.json` remains plaintext metadata.

So the memory system is already local-first and mostly database-backed, but the
Core is not yet fully encrypted by default.
