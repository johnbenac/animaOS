# Repository Guidelines

## Project Structure & Module Organization
This repo is a `pnpm` + Turborepo monorepo.
- `apps/api`: Bun + Hono backend (`src/routes`, `src/db`, `src/agent`, `src/llm`). Drizzle migrations live in `apps/api/drizzle/`.
- `apps/desktop`: React + Vite + Tailwind + Tauri desktop app (`src/pages`, `src/components`, `src/context`, `src/lib`; Rust host in `src-tauri/`).
- `memory/`: local markdown memory data used by the app.
- `docs/`: project documentation (for example `docs/whitepaper.md`).

## Build, Test, and Development Commands
Run from repo root unless noted.
- `pnpm install`: install workspace dependencies.
- `pnpm dev`: start all app dev tasks through Turbo.
- `pnpm build`: build all workspaces.
- `pnpm lint`: run Turbo lint pipeline (add per-package `lint` scripts when introducing linting).
- `pnpm db:push`: run API DB migrations.
- `pnpm db:studio`: open Drizzle Studio for DB inspection.
- `pnpm --filter api dev`: run backend only on port `3031`.
- `pnpm --filter desktop dev`: run desktop web UI only.
- `pnpm --filter desktop tauri dev`: run full Tauri desktop app.

## Coding Style & Naming Conventions
- Language baseline is TypeScript with `strict` mode enabled in both apps.
- Follow existing style: 2-space indentation, semicolons, double quotes.
- React components and context providers use `PascalCase` filenames (for example `ProtectedRoute.tsx`); route/domain modules use concise lowercase names (for example `chat.ts`).
- Keep features grouped by domain (route, DB, UI page, API client updates together in one PR).

## Testing Guidelines
There is no committed automated test suite yet. For every change:
- build both apps (`pnpm build`),
- smoke-test critical flows (auth, chat, memory, settings),
- verify API health endpoint: `GET /health`.
When adding tests, prefer `*.test.ts` / `*.test.tsx` naming near the code under test.

## Commit & Pull Request Guidelines
Current history is minimal (`init`), so use clear, imperative commit messages going forward (for example `api: validate config payload`).
PRs should include:
- concise summary of behavior changes,
- affected areas (`apps/api`, `apps/desktop`, migrations),
- screenshots/GIFs for UI changes,
- migration or setup notes when DB/config behavior changes.

## Security & Configuration Tips
- Do not commit provider API keys or local secrets.
- Keep sensitive values in local environment/runtime config only.
- Treat `memory/` content as user data; avoid checking in private personal data.
