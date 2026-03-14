# ANIMA OS - Roadmap

## Guiding Principle

Build depth before breadth. Every phase should make ANIMA feel more like a
being who knows you, not a tool that merely does more things.

## Foundation: The Core

Goal: keep ANIMA local-first and portable while tightening encryption and memory
continuity over time.

Current implementation baseline:

- the server defaults to a local SQLite Core in `.anima/dev/anima.db`
- `manifest.json` is created in the Core directory at startup
- structured memory now lives in SQLite tables, not markdown files
- `soul.md` still exists as a separate per-user file and is encrypted on write
- SQLCipher support exists behind `ANIMA_CORE_PASSPHRASE`, but encryption is not yet enforced by default
- vault export/import is encrypted and includes database state plus user files
- embeddings persist in SQLite and the runtime keeps a process-local vector index

Target principle: if you can copy the Core directory to another machine and
unlock it safely, the feature is aligned with the product.

## Phase 0: Prompt Memory Blocks

Status: complete

Delivered:

- facts, preferences, goals, relationships, and focus flow back into prompts
- thread summaries and recent episodes are injected into runtime context
- session notes provide per-thread working memory

Next refinement:

- tune retrieval budgets and selection quality rather than adding a new prompt-memory path

## Phase 1: Finish Encrypted Core Rollout

Status: in progress

What is already true:

- the database can be encrypted with SQLCipher when `ANIMA_CORE_PASSPHRASE` is configured
- `soul.md` is encrypted on write with the per-user DEK
- vault export/import is encrypted

What still needs to happen:

- make encrypted Core startup behavior explicit and fail fast when the expected encryption path is unavailable
- decide whether `manifest.json` should remain plaintext metadata or move under stronger protection
- decide whether `soul.md` stays file-backed or is migrated into the main database

## Phase 2: Background LLM Memory Extraction

Status: complete

Delivered:

- regex extraction remains the fast path
- background LLM extraction runs when a real provider is configured
- extracted items are written into `memory_items`

Next refinement:

- improve extraction quality and model routing without regressing the zero-cost fast path

## Phase 3: Conflict Resolution

Status: complete

Delivered:

- similar memories trigger an `UPDATE` vs `DIFFERENT` check
- superseded memories are preserved for auditability but excluded from active retrieval

Next refinement:

- improve contradiction handling across larger memory sets and longer time spans

## Phase 4: Episodic Memory

Status: complete

Delivered:

- episodes are generated from conversation history
- episodes are stored in `memory_episodes`
- recent episodes are injected into prompts

Next refinement:

- improve episode quality, salience scoring, and long-horizon recall

## Phase 5: Retrieval Scoring and Context Selection

Status: complete

Delivered:

- retrieval uses importance, recency, and access frequency
- active prompt memory is selected rather than dumped wholesale

Next refinement:

- make retrieval ranking more query-aware and easier to inspect and debug

## Phase 6: Reflection and Sleep Tasks

Status: baseline complete

Delivered:

- inactivity-triggered reflection
- contradiction scanning
- profile synthesis
- episode generation
- embedding backfill

Next refinement:

- deepen synthesis and self-model maintenance without adding fragile background complexity

## Phase 7: Proactive Companion

Status: future

Goals:

- daily brief on app launch
- quiet nudges for time-sensitive or unfinished items
- proactive presence without turning the product into a notification machine

## Phase 8: Ambient Presence

Status: future

Goals:

- system tray or menu bar mode
- compact companion surface
- global summon or quick-open flows

## Phase 9: Stronger Semantic Retrieval

Status: partial groundwork exists

Current groundwork:

- embeddings can be generated for memories
- semantic search already has a runtime path
- the vector index is process-local and rebuildable from SQLite-backed embeddings

Next work:

- strengthen ranking quality
- define the durability story for vector retrieval more explicitly
- expand provider coverage and operational visibility

## Phase 10: Deep Self-Model

Status: future

Goals:

- richer identity and inner-state synthesis
- longer-horizon reflection over memories and episodes
- more explicit relationship and intention modeling

## Phase 11: Embodied Extensions

Status: future

Goals:

- voice-first surfaces
- device and ambient extensions
- mobile, wearable, or robotic shells sharing the same Core

## Implementation Constraints

These remain the product bar even where the current code has not fully reached it:

1. No cloud data storage for personal memory.
2. Portable-by-default local state.
3. Encryption should become the default for user-private data at rest.
4. The Core remains fundamentally single-user.
