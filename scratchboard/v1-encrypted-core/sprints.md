# Encrypted Core Sprints

## Sprint 1

Duration: 1 day

Done when:

- The security scope is frozen across Core data, bootstrap metadata, and desktop session artifacts.
- The migration target state is agreed.
- The current docs drift list is captured.

## Sprint 2

Duration: 1-2 days

Done when:

- The primary local Core store cannot run in plaintext by accident.
- First-run and unlock flows are defined and wired for dev and packaged desktop paths.
- Wrong-passphrase and missing-encryption states fail clearly.

## Sprint 3

Duration: 1-2 days

Progress:

- `users/<id>/soul.md` now encrypts on write and migrates legacy plaintext on first read.
- Desktop unlock state now stays in memory, and legacy `localStorage` session values are purged instead of reused.

Done when:

- File-backed personal artifacts are encrypted in place or moved into the encrypted DB.
- Plaintext `soul.md` and similar content no longer remain on disk after successful migration.
- Desktop no longer persists reusable unlock artifacts in plaintext browser storage.

## Sprint 4

Duration: 1 day

Done when:

- Existing plaintext local data migrates safely.
- Roll-forward and rollback expectations are defined.
- Copy and restore portability checks pass.

## Sprint 5

Duration: 1 day

Done when:

- Automated tests and manual smoke tests pass.
- Docs accurately describe the shipped encryption model.
- Release validation confirms the Core is unreadable without the passphrase.

---

_Version: v1-encrypted-core_
_PRD: [Encrypted Core v1](../../docs/prd/encrypted-core-v1.md)_
_Prior versions: None_
_Author: Julio Caesar_
_Created: 2026-03-14_
