# ANIMA Build & Packaging Guide

This guide covers the current Tauri desktop packaging flow.

Important: the packaged desktop app still bundles the legacy `apps/api` Bun
sidecar, not the Python `apps/server` process used in local development.

## Prerequisites

- Bun 1.3+
- Rust toolchain (`rustup`, `cargo`)
- Tauri platform prerequisites
- platform signing or notarization tooling as needed for release

Platform notes:

- macOS: Xcode Command Line Tools
- Windows: MSVC build tools and WebView2 runtime
- Linux: WebKitGTK and required system libraries

## Install Dependencies

Run once from repo root:

```bash
bun install
```

## Build Commands

Run from repo root.

### App Bundle

```bash
bun --filter desktop package:app
```

This runs the desktop release prep script, compiles the legacy API sidecar for
the Tauri bundle, builds the frontend, and produces the platform app bundle.

On macOS, the final bundle is emitted under Tauri's
`target/release/bundle/macos/` output directory.

### Full Installer Targets

```bash
bun --filter desktop package
```

This runs the full `tauri build` target set for the current platform.

## What Is Bundled

Inside the packaged app resources:

- `bin/anima-api` or `bin/anima-api.exe`
- `prompts/`
- `drizzle/`

At runtime the desktop shell sets:

- `ANIMA_DATA_DIR`
- `ANIMA_PROMPTS_DIR`
- `ANIMA_MIGRATIONS_DIR`

## Runtime Data Folder

The packaged desktop app creates a per-user data directory and the legacy API
sidecar stores its runtime data there.

Typical contents:

- `anima.db`
- `users/<user_id>/memory/`
- `users/<user_id>/soul.md`

Typical locations:

- macOS: `~/Library/Application Support/com.leoca.anima`
- Linux: `~/.local/share/com.leoca.anima`
- Windows: `%APPDATA%/com.leoca.anima`

## Release Checklist

1. Run `bun --filter desktop package:app` or `bun --filter desktop package`.
2. Smoke-test auth, chat, memory, and soul flows on a clean profile.
3. Verify the sidecar writes customer data to the app data directory, not the repo.
4. Ship only the packaged artifact and normal installer assets.

## Troubleshooting

- `Missing required environment variable: ANIMA_DATA_DIR`
  This is expected if you run the sidecar directly instead of through Tauri.

- `Failed to start server. Is port 3031 in use?`
  Another local process is already bound to port `3031`.

- DMG creation fails in headless environments
  Build the `.app` first, then create or sign the DMG in a GUI-capable release environment.
