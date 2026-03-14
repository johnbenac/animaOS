# Docs Changelog

## 2026-03-14

- clarified the runtime identity layering in docs: `persona` is now documented as a thin seed, `soul` as the user-specific charter, and `self_identity` as the evolving adaptive layer
- added `docs/agent-runtime-improvements.md`, a detailed assessment of the live Python agent runtime with prioritized improvements around turn atomicity, prompt budgeting, streaming/tool hardening, and self-model governance
- synced database docs to the current SQLite-default server behavior and clarified that Postgres is now an override, not the default path
- rewrote memory and roadmap docs to reflect the current hybrid Core state: structured memory in SQLite, encrypted-on-write `soul.md`, optional SQLCipher, and the live reflection/search pipeline
- fixed stale repo-path references in the agent migration, implementation-plan, build, and legacy graph docs
- synced runtime and packaging docs with the current monorepo shape: `apps/server` is the active local backend, the packaged desktop app still bundles the legacy `apps/api` sidecar, and Telegram/Discord webhook docs now call out that legacy boundary explicitly
- corrected stale architecture wording in the whitepaper, implementation plan, and migration docs so they match the current SQLite Core, database-backed soul migration, and live prompt/runtime feature set
- added `docs/python-backend-fix-plan.md`, a backend-only hardening plan covering provider/config correctness, orchestrator reliability, memory quality, and encrypted-Core follow-up work

## 2026-03-15

- added `docs/structured-memory-claims-design.md`, a long-term backend design for moving from English-biased string memories to structured multilingual memory claims with explicit schema, resolution rules, and migration phases
