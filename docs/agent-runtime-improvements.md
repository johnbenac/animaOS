---
title: Python Agent Runtime Improvement Plan
last_edited: 2026-03-14
status: implemented
scope: apps/server
---

# Python Agent Runtime Improvement Plan

This document records the current assessment of the Python agent runtime in `apps/server` and the next improvements that would most increase durability, clarity, and product quality.

It is intentionally not a migration doc. The loop runtime already exists. The question now is how to harden it without losing the product direction that makes ANIMA distinctive.

## Current State

The current runtime has crossed the line from "thin scaffold" into a real companion substrate.

Core strengths:

- explicit loop runtime in [`apps/server/src/anima_server/services/agent/runtime.py`](../apps/server/src/anima_server/services/agent/runtime.py)
- persisted threads, runs, steps, messages, memory items, episodes, and session notes in [`apps/server/src/anima_server/models/agent_runtime.py`](../apps/server/src/anima_server/models/agent_runtime.py)
- prompt composition owned by ANIMA, not by an external agent framework, in [`apps/server/src/anima_server/services/agent/system_prompt.py`](../apps/server/src/anima_server/services/agent/system_prompt.py)
- layered memory injection in [`apps/server/src/anima_server/services/agent/memory_blocks.py`](../apps/server/src/anima_server/services/agent/memory_blocks.py)
- session-memory tools in [`apps/server/src/anima_server/services/agent/tools.py`](../apps/server/src/anima_server/services/agent/tools.py)
- self-model, emotional context, semantic retrieval, and feedback-signal plumbing in the server runtime path

The current implementation is therefore directionally strong. The main work left is not "more agent features." It is enforcing invariants and controlling complexity.

## Verification Basis

This assessment is grounded in the live code and current tests, not in older architecture assumptions.

Relevant passing test subsets on 2026-03-14:

- `uv run --project apps/server pytest apps/server/tests/test_agent_runtime.py apps/server/tests/test_chat.py apps/server/tests/test_agent_memory_blocks.py apps/server/tests/test_session_memory.py -q`
- `uv run --project apps/server pytest apps/server/tests/test_consciousness.py -q`

## 1. Make Turns Atomic and Serialized

### Current state

The request path in [`apps/server/src/anima_server/services/agent/service.py`](../apps/server/src/anima_server/services/agent/service.py) still performs read-then-write turn setup in process memory:

- load or create thread
- allocate `sequence_id`
- append the user message
- invoke the model
- persist assistant and tool output afterward

The current sequence allocator in [`apps/server/src/anima_server/services/agent/persistence.py`](../apps/server/src/anima_server/services/agent/persistence.py) is still `max(sequence_id) + 1`, while uniqueness is enforced only by the database constraint on `thread_id, sequence_id`.

### Why this matters

This is the runtime's most important remaining correctness gap.

This is not primarily a multi-user concern. It is a same-user, same-thread concurrency concern.

A single user can still produce overlapping requests by:

- double-submitting
- retrying after a slow response
- having more than one client surface open
- hitting the API directly
- triggering another request while a previous stream is still live

If two same-user requests overlap:

- sequence allocation can race
- thread state can be read from a stale view
- failures can leave partial turn artifacts in active context

The current desktop UI reduces the likelihood of this in the primary chat surface by disabling input while streaming, but that is only a client-side guard. The backend still defines whether transcript order and continuity are actually trustworthy.

For a companion product built on continuity, this matters more than another tool or another memory source. If turn order is not trustworthy, memory quality and self-model quality become suspect downstream.

### What to change

- Serialize turns per `user_id` or `thread_id`.
- Move sequence allocation to a DB-safe primitive instead of `max + 1`.
- Treat a turn as one atomic unit with an explicit policy for failure.
- Ensure failed turns do not replay orphaned user messages as valid history.

### Recommended implementation shape

Add a turn coordinator layer that owns:

- per-user or per-thread async locking
- thread loading
- sequence reservation
- turn transaction boundaries

That keeps these concerns out of the service facade and gives the runtime a single place to define "what counts as a committed turn."

### Tests to add

- concurrent same-user submissions do not collide
- failed LLM invocation does not pollute live context
- retry after failure produces a clean next turn

## 2. Add a Real Prompt-Budget Planner

### Current state

The runtime now injects many memory layers via [`apps/server/src/anima_server/services/agent/memory_blocks.py`](../apps/server/src/anima_server/services/agent/memory_blocks.py):

- `soul`
- five self-model blocks
- emotional context
- semantic retrieval hits
- facts
- preferences
- goals
- relationships
- current focus
- thread summary
- recent episodes
- session memory

Compaction in [`apps/server/src/anima_server/services/agent/compaction.py`](../apps/server/src/anima_server/services/agent/compaction.py) still budgets only transcript messages.

### Why this matters

This is now the main scalability issue inside the runtime.

The richest context increasingly lives outside the transcript. That means the system can exceed practical context budgets even if transcript compaction is working correctly.

The priority comments in `memory_blocks.py` are useful design intent, but they are not runtime enforcement. Right now the runtime has richer memory than it has budget governance.

### What to change

Introduce one prompt-budget planner that runs before final prompt assembly and decides:

- which blocks are mandatory
- which blocks are optional
- how much budget each block class can consume
- what gets summarized or dropped first
- how semantic hits compete with long-term fact blocks and session memory

### Recommended implementation shape

Use explicit tiers:

1. Never drop: system rules, guardrails, persona, soul
2. Strongly prefer: high-priority self-model slices, current focus, recent summary
3. Query-relevant: semantic retrieval hits, targeted facts/preferences
4. Nice-to-have: episodes, lower-priority self-model details, broad relationship context

Each tier should have a hard char/token budget. Do not rely on ad hoc truncation spread across block builders.

### Tests to add

- saturated prompt budget still preserves priority-0 and priority-1 blocks
- semantic hits displace lower-value generic blocks
- large self-model content is trimmed predictably rather than arbitrarily

## Identity Layering Recommendation

The runtime now has three distinct identity layers, and the docs should treat
them as different on purpose:

- `persona`: the thin seed voice and baseline temperament from the static
  template under `services/agent/templates/persona/`
- `soul`: the user-authored charter for who ANIMA should be in this
  relationship, stored in `self_model_blocks` with `section="soul"`
- `self_identity`: the evolving self-understanding that the system learns over
  time and injects dynamically into the prompt

These should not be collapsed into one concept.

Recommended role split:

- keep `persona` as a small fallback foundation
- treat `soul` as the canonical user-specific identity directive
- let `self_identity` evolve beneath that without contradicting the soul

Why this split is useful:

- a static persona template gives safe default behavior before the user shapes
  the companion
- the soul is personal and editable, so it should outrank the generic template
- self-identity should be learned and revisable, not frozen into the template

What should change over time is not the existence of three layers, but their
relative weight:

- `persona` should get thinner
- `soul` should become the main persistent charter
- `self_identity` should become the main adaptive layer

In prompt-budget terms, this means:

1. never drop: system rules, guardrails, thin persona seed, soul
2. strongly prefer: `self_identity`, current focus, recent thread summary
3. optional under budget pressure: lower-priority self-model sections and broad memory context

## 3. Split the Turn Pipeline into Explicit Stages

### Current state

[`apps/server/src/anima_server/services/agent/service.py`](../apps/server/src/anima_server/services/agent/service.py) now handles:

- semantic retrieval
- feedback signal collection
- memory-block construction
- tool-context setup
- runtime invocation
- persistence
- compaction
- consolidation scheduling
- reflection scheduling

### Why this matters

This file still reads clearly, but it is already the point where otherwise-good features will start colliding.

The risk is not style. The risk is that turn semantics become implicit because too many concerns are interleaved in one function.

### What to change

Split the service path into explicit stages, for example:

- `prepare_turn_context(...)`
- `invoke_turn_runtime(...)`
- `persist_turn_result(...)`
- `run_post_turn_hooks(...)`

### Why this is worth doing

- easier to reason about failure boundaries
- easier to insert observability
- easier to test individual stages
- easier to add future memory layers without turning the entrypoint into a god-function

## 4. Unify Provider Truth Between Runtime and Config

### Current state

The runtime provider list in [`apps/server/src/anima_server/services/agent/llm.py`](../apps/server/src/anima_server/services/agent/llm.py) supports:

- `ollama`
- `openrouter`
- `vllm`

The config route in [`apps/server/src/anima_server/api/routes/config.py`](../apps/server/src/anima_server/api/routes/config.py) still advertises:

- `ollama`
- `openai`
- `anthropic`

### Why this matters

This creates impossible states:

- the UI can present providers that the runtime cannot actually load
- docs and behavior drift apart
- debugging becomes harder because config values no longer imply real runtime capability

### What to change

- Derive API-visible providers from the same source the runtime uses.
- Validate config updates against that source.
- Remove dead providers unless there is active implementation work behind them.

### Why this is worth doing

This is a small cleanup with disproportionate architectural value. A runtime that has a clear contract feels much more stable than one that accepts fantasy states.

## 5. Harden Streaming and Tool Protocol Handling

### Current state

The streaming path in [`apps/server/src/anima_server/services/agent/service.py`](../apps/server/src/anima_server/services/agent/service.py) runs a worker task and awaits it in `finally`.

The OpenAI-compatible streaming adapter in [`apps/server/src/anima_server/services/agent/adapters/openai_compatible.py`](../apps/server/src/anima_server/services/agent/adapters/openai_compatible.py) also treats malformed streamed tool-call arguments as `{}`.

### Why this matters

Two issues remain:

- disconnected SSE clients can still leave the worker running to completion
- malformed tool-call arguments degrade silently rather than failing explicitly

For a local companion, these are acceptable in early development. For a durable runtime, they are weak contracts.

### What to change

- cancel worker tasks when the client disconnects
- make adapter and tool execution paths cancellation-aware
- treat invalid streamed tool-call arguments as a step error, not as an empty dict
- add argument validation before tool execution

### Tests to add

- streaming disconnect cancels the worker
- malformed tool-call JSON yields a structured step failure
- tools never run with silently-defaulted arguments after protocol corruption

## 6. Either Implement or Remove `ContinueToolRule`

### Current state

[`apps/server/src/anima_server/services/agent/rules.py`](../apps/server/src/anima_server/services/agent/rules.py) defines `ContinueToolRule`, but the current loop in [`apps/server/src/anima_server/services/agent/runtime.py`](../apps/server/src/anima_server/services/agent/runtime.py) does not use it as a meaningful orchestration decision.

### Why this matters

Unused orchestration surface is expensive. It suggests capabilities the runtime does not actually guarantee.

That is especially risky in agent systems, where people start designing prompts and tools around semantics that do not really exist in code.

### What to change

Choose one:

- fully implement continue-tool semantics in the loop
- remove the rule until there is a real use case

### Why this is worth doing

Keeping the runtime small and truthful is a major strength of this codebase. Preserve that.

## 7. Scope Reflection Per User or Thread

### Current state

[`apps/server/src/anima_server/services/agent/reflection.py`](../apps/server/src/anima_server/services/agent/reflection.py) still stores one global pending task and one global last-activity timestamp for the whole process.

### Why this matters

This is acceptable only if the runtime is permanently single-user in one process with one active conversational surface.

The rest of the schema does not model the system that way. The DB and API still model users and threads explicitly.

### What to change

- track reflection timers by `user_id` or `thread_id`
- keep cancellation scoped to that key
- make the runtime consistent about what "conversation inactivity" means

### Tests to add

- user A activity does not cancel user B reflection
- repeated activity for one thread resets only that thread's timer

## 8. Clarify What Persistence Is Supposed to Guarantee

### Current state

The runtime has a well-shaped persistence schema, but `StepExecutionResult.raw_response` is not meaningfully persisted and step rows are written only after the in-memory turn completes.

### Why this matters

Right now the persistence layer is strong for:

- historical transcript continuity
- debugging completed turns
- compaction reuse

It is not yet strong for:

- crash-resilient mid-turn recovery
- replaying raw provider behavior
- full postmortem analysis of adapter normalization

That is not wrong. It just needs an explicit decision.

### What to change

Choose one of two directions:

- keep persistence normalized and lightweight, and simplify the runtime contract accordingly
- or persist richer step artifacts and possibly step-by-step writes if replay/debugging is a real product need

### Why this is worth doing

Ambiguous observability contracts create the worst kind of complexity: code that looks more durable than it really is.

## 9. Add Governance Around Self-Model Writes

### Current state

The self-model is now a serious part of the architecture. It can be read and written by multiple subsystems, including:

- inner monologue
- intentions
- feedback signals
- reflection/sleep-time work

### Why this matters

This is powerful, but it is also the next place the system can become chaotic.

Without policy, multiple writers can cause:

- oscillating identity text
- noisy growth logs
- unstable inner-state content
- accidental duplication of "what I learned"

### What to change

Add a self-model policy layer that decides:

- which subsystem owns which section
- which sections may be rewritten versus appended
- how often each section can change
- when a proposed change must become a growth-log entry instead of an overwrite

### Recommended ownership model

- `identity`: rare rewrite, high-threshold changes only
- `inner_state`: volatile, reflection/monologue owned
- `working_memory`: bounded mutable buffer with expiry
- `growth_log`: append-only
- `intentions`: mutable, but rule-based and deduplicated

### Tests to add

- repeated feedback signals do not spam growth-log entries
- intentions updates deduplicate rather than churn
- low-confidence monologue output cannot rewrite stable identity sections

## 10. Expand Tests from Feature Checks to Invariant Checks

### Current state

The runtime already has good feature coverage:

- chat/runtime behavior
- memory blocks
- session memory
- self-model and emotional context

### What is missing

The next test gap is not breadth. It is invariants:

- concurrent same-user turns
- failed-turn cleanup
- streaming disconnect cancellation
- prompt-budget saturation
- self-model write conflicts
- config/runtime provider mismatch rejection

### Why this matters

The codebase is leaving the phase where "feature exists" is enough. The next phase is "feature remains stable under pressure."

## Recommended Sequence

If improvement work needs to be staged, the highest-leverage order is:

1. atomic turns and sequence safety
2. prompt-budget planner
3. split the turn pipeline into explicit stages
4. provider/config unification
5. streaming and tool-protocol hardening
6. per-user reflection scheduling
7. self-model write governance
8. invariant-focused tests

## Closing View

The Python runtime is now distinctive for the right reasons:

- it is explicit
- it owns its own prompt and memory logic
- it is building toward continuity, not just task execution
- it has the beginnings of an actual inner architecture

That makes the next work more important, not less. The system now has enough depth that correctness, budgeting, and write governance matter more than adding another clever memory source.
