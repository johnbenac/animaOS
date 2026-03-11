# Repository Guidelines

## Project Structure & Module Organization

This repo is a mixed monorepo:

- `apps/server`: Python + FastAPI backend (`src/anima_server`, `alembic/`). SQLAlchemy models live under `src/anima_server/models/` and Alembic revisions live in `alembic/versions/`.
- `apps/api`: legacy Bun + Hono backend (`src/routes`, `src/db`, `src/agent`, `src/llm`). Drizzle migrations live in `apps/api/drizzle/`.
- `apps/desktop`: React + Vite + Tailwind + Tauri desktop app (`src/pages`, `src/components`, `src/context`, `src/lib`; Rust host in `src-tauri/`).
- `docs/`: project documentation (for example `docs/whitepaper.md`).
- `memory/`: local markdown memory data used by the app.

Prefer new backend work in `apps/server`. Treat `apps/api` as legacy unless a task explicitly targets it.

## Build, Test, and Development Commands

Run from repo root unless noted.

- `bun install`: install workspace dependencies.
- `uv sync --all-packages`: install/update Python workspace dependencies.
- `bun dev`: start the Python server and desktop app through `nx`.
- `bun run dev:server`: run the FastAPI backend on port `3031`.
- `bun run dev:desktop`: run the desktop web UI.
- `bun run build`: build `apps/server` and `apps/desktop`.
- `bun run lint`: run the Python lint pipeline and desktop typecheck.
- `bun run test`: run Python backend tests.
- `bun run db:server:up`: start local PostgreSQL for `apps/server`.
- `bun run db:server:revision -- "<message>"`: create an Alembic autogenerate revision for `apps/server`.
- `bun run db:server:upgrade`: apply Python backend migrations.
- `bun run db:server:current`: show the current Python backend Alembic revision.
- `bun run db:push`: run legacy API Drizzle migrations.
- `bun run db:studio`: open legacy Drizzle Studio.

## Coding Style & Naming Conventions

- Language baseline is Python for `apps/server` and TypeScript for the desktop and legacy API.
- Python follows SQLAlchemy 2.0 typing style with `Mapped[...]` and `mapped_column(...)`.
- TypeScript follows existing style: 2-space indentation, semicolons, double quotes.
- React components and context providers use `PascalCase` filenames (for example `ProtectedRoute.tsx`); route/domain modules use concise lowercase names (for example `chat.ts`).
- Keep features grouped by domain (route, DB, UI page, API client updates together in one PR).

## Testing Guidelines

For every change:

- build the active apps (`bun run build`),
- smoke-test critical flows (auth, chat, memory, settings),
- verify health endpoint: `GET /health`.
- For Python backend changes, run `bun run test` and the relevant Alembic command if schema changed.
- For API unit tests, place files under domain-local `__tests__` folders (for example `apps/api/src/agent/__tests__`, `apps/api/src/lib/__tests__`).
- For Python backend tests, place files under `apps/server/tests/`.
- For LLM-related behavior, mock model/config/db/memory boundaries and test deterministic logic (fallbacks, caching, filtering) without real provider calls.

## Prompt & Date Rules

- Keep agent prompts in `apps/api/prompts/*.md` and load them via `renderPromptTemplate(...)`; avoid large inline prompt strings in TypeScript files.
- Use `apps/api/src/lib/task-date.ts` as the single source of truth for due-date parsing and open/overdue checks across routes, agents, and cron jobs.

## Database Workflow

- For `apps/server` schema creation or migration work, use the `create-migration` skill.
- Treat commands like `alembic revision`, `alembic upgrade`, and `docker compose up postgres` as execution details inside that workflow, not the workflow itself.
- Prefer PostgreSQL for `apps/server`; SQLite was only a bootstrap step and should not be treated as the target backend.

## Commit & Pull Request Guidelines

Current history is minimal (`init`), so use clear, imperative commit messages going forward (for example `api: validate config payload`).
PRs should include:

- concise summary of behavior changes,
- affected areas (`apps/server`, `apps/api`, `apps/desktop`, migrations),
- screenshots/GIFs for UI changes,
- migration or setup notes when DB/config behavior changes.

## Security & Configuration Tips

- Do not commit provider API keys or local secrets.
- Keep sensitive values in local environment/runtime config only.
- Treat `memory/` content as user data; avoid checking in private personal data.
