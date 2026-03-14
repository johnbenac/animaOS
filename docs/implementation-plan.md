# ANIMA Core — Implementation Plan

> Status: active
> Created: 2026-03-14
> Goal: Transform the current server into a portable, encrypted, memory-intelligent personal AI

---

## Current Inventory

What exists and works today in `apps/server/`:

| Layer | Status | Key Files |
|---|---|---|
| Runtime loop | Working | `runtime.py`, `service.py` |
| Persistence | Working | `persistence.py`, `models/agent_runtime.py` (AgentThread, AgentRun, AgentStep, AgentMessage) |
| Tool rules | Working | `rules.py`, `executor.py` |
| System prompt | Working | `system_prompt.py`, Jinja2 templates (persona, rules, guardrails, memory blocks) |
| Memory blocks | Partial | `memory_blocks.py` — `human`, `current_focus`, `thread_summary` wired; **facts/preferences NOT wired** |
| Memory store | Partial | `memory_store.py` — file read/write for markdown memory; **plaintext only, no encryption** |
| Consolidation | Minimal | `consolidation.py` — regex-only extraction (5 fact patterns, 3 preference patterns); **no LLM** |
| Compaction | Working | `compaction.py` — token-based trigger, non-LLM summary |
| Streaming | Working | `streaming.py` — SSE events (chunk, tool_call, tool_return, usage, done, error) |
| LLM adapters | Working | `adapters/openai_compatible.py` — supports ollama, openrouter, vllm |
| Crypto | Working | `crypto.py` — AES-256-GCM, Argon2id, DEK wrap/unwrap |
| Data crypto | Working | `data_crypto.py` — `maybe_encrypt_for_user()`, `maybe_decrypt_for_user()` using session DEK |
| Vault | Working | `vault.py` — full export/import with encryption, DB snapshot + file snapshot |
| Sessions | Working | `sessions.py` — in-memory DEK store keyed by user, 7-day TTL |
| Auth | Working | `auth.py` — Argon2 password hashing, user creation with DEK, authentication with DEK unwrap |
| DB | PostgreSQL default | `config.py` defaults to `postgresql+psycopg://...`, but `session.py` and `db/url.py` already handle SQLite |
| Dependencies | psycopg required | `pyproject.toml` has `psycopg[binary]` as hard dependency |

---

## What Needs to Happen (Ordered)

### Task 1: Wire Facts and Preferences Into Prompts

**Why first:** The system already extracts facts/preferences to markdown files. It just never reads them back. This is a one-function fix that makes the AI immediately smarter.

**Files to change:**
- `memory_blocks.py` — add `build_facts_memory_block()` and `build_preferences_memory_block()`

**What to do:**
1. Add a function that reads `memory/user/facts.md` via `memory_store.read_memory_text()`
2. Add a function that reads `memory/user/preferences.md` via `memory_store.read_memory_text()`
3. Strip frontmatter (reuse `strip_frontmatter()` already in `memory_blocks.py`)
4. Cap each at 2000 chars (truncate from top — oldest entries — if over)
5. Add both to `build_runtime_memory_blocks()` return tuple
6. Add tests

**Acceptance criteria:**
- [ ] Facts and preferences appear in the system prompt as `<facts>` and `<preferences>` blocks
- [ ] Blocks are empty/absent when the files don't exist (no crash)
- [ ] Existing tests still pass

**Estimated scope:** ~50 lines of code, 1 file changed

---

### Task 2: Switch Default Database to SQLite

**Why second:** The Core must be a single portable directory. PostgreSQL is a server process — it doesn't travel on a USB stick. SQLite is a single file.

**Files to change:**
- `config.py` — change `DEFAULT_DATABASE_URL`
- `pyproject.toml` — remove `psycopg[binary]` from hard deps (make optional), add `aiosqlite` if needed
- `vault.py` — the `reset_identity_sequences()` function already no-ops for non-PostgreSQL; verify no other pg-specific code
- `alembic/env.py` — already dialect-agnostic, verify migrations run on SQLite
- Alembic migration files — audit for PostgreSQL-specific SQL (sequences, `setval`, etc.)

**What to do:**
1. Change default to `sqlite:///{data_dir}/anima.db`
2. Move `psycopg[binary]` to optional dependency group
3. Test that `alembic upgrade head` works with SQLite
4. Test that the full chat flow works with SQLite (create user, login, chat, persist, reload)
5. Verify vault export/import works with SQLite

**Gotchas to watch:**
- SQLite has no `SERIAL` / sequences — Alembic's `autoincrement=True` should work but verify
- SQLite JSON support: `JSON` column type works in SQLAlchemy but stores as TEXT — verify `content_json`, `tool_calls_json`, `usage_json` queries still work
- `DateTime(timezone=True)` — SQLite stores these as strings; verify ordering and comparison still work
- `server_default=func.now()` — may need `default=` instead for SQLite; check Alembic migration compatibility

**Acceptance criteria:**
- [ ] `ANIMA_DATABASE_URL` not set → server starts with SQLite at `{data_dir}/anima.db`
- [ ] All existing tests pass with SQLite
- [ ] PostgreSQL still works if explicitly configured (don't break it, just change the default)
- [ ] `anima.db` file lives inside `.anima/` directory

---

### Task 3: Encrypt Memory Files at Rest

**Why third:** This turns the Core into a true cold wallet. Without this, anyone who finds the USB stick can read the memories.

**Files to change:**
- `memory_store.py` — encrypt on write, decrypt on read
- `data_crypto.py` — already has `maybe_encrypt_for_user()` / `maybe_decrypt_for_user()`
- `memory_blocks.py` — reads must go through decrypt path
- `consolidation.py` — writes must go through encrypt path

**What to do:**
1. Modify `write_memory_text()` to encrypt content before writing using `maybe_encrypt_for_user(user_id, content)`
2. Modify `read_memory_text()` to decrypt content after reading using `maybe_decrypt_for_user(user_id, content)`
3. The `maybe_*` functions already gracefully no-op if no DEK is in session (user not logged in) — plaintext fallback is acceptable during development
4. When DEK is available, files are encrypted; when not, they're readable as plaintext (gradual migration)
5. Update vault export/import to handle encrypted files (current `read_data_snapshot()` reads raw bytes — encrypted files are still text, so this may already work)

**Design decision:** Keep `.md` extension (not `.md.enc`). The content is encrypted text (base64-encoded ciphertext with the `enc1:` prefix from `crypto.py`). The file extension doesn't matter — what matters is the content is gibberish without the DEK.

**Acceptance criteria:**
- [ ] With active DEK: memory files written encrypted, read back decrypted transparently
- [ ] Without active DEK: files written as plaintext (graceful fallback)
- [ ] Vault export/import still works with encrypted files
- [ ] Existing consolidation and memory block tests pass
- [ ] Manual verification: open a memory file in text editor → see `enc1:...` gibberish

---

### Task 4: LLM-Based Memory Extraction

**Why fourth:** Regex catches ~20% of personal information. LLM catches ~90%. This is the difference between "sometimes remembers" and "reliably learns."

**Files to change:**
- `consolidation.py` — add LLM extraction path alongside existing regex
- `config.py` — add extraction model config (can differ from chat model)
- New: `extraction_prompt.py` or inline in `consolidation.py`

**What to do:**
1. Keep existing regex extractors as zero-cost fast path (they run first, no LLM call needed)
2. Add an LLM extraction function that runs in the background task after regex
3. Send both user message and assistant response to the LLM with a structured extraction prompt
4. Prompt returns JSON: `[{"content": "...", "category": "fact|preference|goal|relationship", "importance": 1-5}]`
5. Deduplicate against regex results and existing memory
6. Write new items to the appropriate files (facts.md, preferences.md)
7. Use the configured chat provider (ollama/openrouter/vllm) — same adapter, possibly different/cheaper model
8. If LLM call fails (model down, timeout), log and continue — regex results still saved

**Extraction prompt (draft):**
```
You are a memory extraction system. Given a conversation turn, extract personal facts and preferences about the user.

Return a JSON array. Each item has:
- "content": the fact or preference as a concise statement
- "category": one of "fact", "preference", "goal", "relationship"
- "importance": 1-5 (5 = identity-defining, 1 = casual mention)

Only extract information the user explicitly stated or clearly implied. Do not infer or speculate.
Return [] if nothing worth remembering was said.
```

**Acceptance criteria:**
- [ ] Background extraction uses LLM when available, falls back to regex-only
- [ ] Extraction processes both user and assistant messages
- [ ] Extracted items include importance scores
- [ ] LLM failure does not break the chat flow
- [ ] New items appear in facts/preferences files after extraction

---

### Task 5: Conflict Resolution on Memory Write

**Why fifth:** Once LLM extraction is producing many items, contradictions will appear. "Works as engineer" and "Works as PM" both in facts.md is confusing.

**Files to change:**
- `consolidation.py` or `memory_store.py` — add conflict check before append
- Reuse the LLM adapter for conflict detection

**What to do:**
1. Before appending a new bullet to facts/preferences, search existing bullets for semantic overlap
2. Use fuzzy string matching first (fast, no LLM): if similarity > 0.7 on the same category, it's a candidate conflict
3. For candidate conflicts, ask LLM: "Is this an update to the existing fact, or a different topic? Answer UPDATE or DIFFERENT."
4. If UPDATE: replace the old bullet with the new one
5. If DIFFERENT: append as new
6. Log all replacements to the daily journal: "Updated: 'Works as engineer' → 'Works as PM'"

**Acceptance criteria:**
- [ ] Contradicting facts are detected and replaced
- [ ] Non-contradicting facts with word overlap are both kept
- [ ] Replacements logged to daily journal
- [ ] LLM conflict check only runs for candidate conflicts (not every item)

---

### Task 6: Episodic Memory

**Why sixth:** With facts working well, the next gap is shared experiences. Episodes are what make "I remember" feel real.

**Files to change:**
- New: `episodes.py` in agent service
- `memory_store.py` — add episode storage helpers
- `memory_blocks.py` — add `build_episodes_memory_block()`
- `consolidation.py` or `service.py` — trigger episode generation

**What to do:**
1. After a conversation with 3+ user turns, fire a background LLM call to generate an episode summary
2. Episode schema: `{date, time, topics[], summary, emotional_arc, significance_score}`
3. Store as monthly markdown: `memory/episodes/2026-03.md` (encrypted)
4. Each episode is a `###` section in the monthly file
5. Add `episodes` memory block that loads the last 3-5 episodes into the prompt
6. Format naturally: "March 14 afternoon — Discussed the Core architecture. User was excited about the cold wallet metaphor. We outlined the full implementation plan."

**Acceptance criteria:**
- [ ] Episodes generated after substantive conversations (3+ turns)
- [ ] Trivial conversations (greetings, single questions) don't generate episodes
- [ ] Episodes appear in the system prompt
- [ ] Episode files are encrypted

---

### Task 7: Core Manifest and Portability

**Why seventh:** With memory, encryption, and episodes working, formalize the Core as a portable artifact.

**Files to change:**
- New: `core.py` — Core manifest management
- `config.py` — add `ANIMA_CORE_PATH` config
- `storage.py` — resolve all paths relative to Core path
- `main.py` — Core validation on startup

**What to do:**
1. On first startup, create `manifest.json` in the Core directory:
   ```json
   {
     "version": 1,
     "created_at": "2026-03-14T...",
     "last_opened_at": "2026-03-14T...",
     "schema_version": "1.0.0"
   }
   ```
2. On subsequent startups, validate manifest and update `last_opened_at`
3. If `schema_version` is older than current, run migration logic
4. `ANIMA_CORE_PATH` env var points to the Core directory (default: `.anima/`)
5. All data paths (SQLite DB, memory files, vault) resolve relative to this path

**Acceptance criteria:**
- [ ] `manifest.json` created on first run
- [ ] Setting `ANIMA_CORE_PATH=/mnt/usb/my-anima` makes the server use that directory for everything
- [ ] Copying the Core directory and pointing to the copy works identically
- [ ] Version mismatch triggers migration or clear error

---

### Task 8: Sleep-Time Quick Reflection

**Why eighth:** All prior tasks run per-turn. A post-conversation reflection sees the full arc and produces better memory.

**Files to change:**
- New: `reflection.py` in agent service
- `service.py` — add inactivity timer
- `consolidation.py` — integrate reflection trigger

**What to do:**
1. Track `last_message_at` per thread (already in `AgentThread` model)
2. After each turn, schedule a delayed task (5 minutes)
3. When the timer fires, check if any new messages arrived since scheduling — if yes, skip
4. If no new messages: run reflection
5. Reflection reads the full conversation since last reflection, generates:
   - Better episode summary (sees full conversation, not single turns)
   - Contradiction scan across memory files
   - Updated `inner-state.md` (what topics are active, user's apparent mood)
6. Use a fast/cheap model

**Acceptance criteria:**
- [ ] Reflection fires ~5 minutes after last message
- [ ] New messages during the wait period cancel the reflection
- [ ] Reflection produces higher-quality episodes than per-turn extraction
- [ ] Reflection errors don't affect the chat system

---

## Dependency Graph

```
Task 1 (Wire facts)          ← standalone, do first
Task 2 (SQLite default)      ← standalone, do early
Task 3 (Encrypt memory)      ← needs Task 1 done (so we encrypt useful files)
Task 4 (LLM extraction)      ← standalone, needs LLM adapter (already exists)
Task 5 (Conflict resolution) ← needs Task 4 (LLM pipeline exists)
Task 6 (Episodes)            ← needs Task 4 (LLM pipeline exists)
Task 7 (Core manifest)       ← needs Task 2 + 3 (SQLite + encryption)
Task 8 (Reflection)          ← needs Task 6 (episodes to generate)
```

Tasks 1, 2, and 4 are independent and can be parallelized.
Tasks 3 and 7 are sequential (encryption → manifest).
Tasks 5, 6, and 8 build on the LLM extraction pipeline.

## Minimum Viable Core

Tasks 1-5 represent the minimum viable Core: the AI reads its own memories, learns from conversations via LLM, resolves contradictions, encrypts everything, and runs on SQLite. That's enough for the "copy to USB, revive on new machine" scenario to actually feel real.

Tasks 6-8 add episodic depth and reflection — they make the AI feel like it *remembers experiences*, not just *knows facts*.

---

## Files Changed Per Task

| Task | Modified | New | Migration |
|---|---|---|---|
| 1 | `memory_blocks.py` | test file | None |
| 2 | `config.py`, `pyproject.toml`, `vault.py` | None | Verify existing Alembic on SQLite |
| 3 | `memory_store.py`, `memory_blocks.py`, `consolidation.py` | None | None |
| 4 | `consolidation.py`, `config.py` | None | None |
| 5 | `consolidation.py` or `memory_store.py` | None | None |
| 6 | `memory_blocks.py`, `consolidation.py` | `episodes.py`, test file | None |
| 7 | `config.py`, `storage.py`, `main.py` | `core.py` | None |
| 8 | `service.py`, `consolidation.py` | `reflection.py` | None |
