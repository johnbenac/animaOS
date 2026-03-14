# Encrypted Core Brief

## Goal

Bring ANIMA's shipped local data model up to its encrypted-by-default promise, without breaking portability or existing local user data.

## What Exists

- No prior PRD or scratchboard version exists for this feature line.
- Vault export and import are already encrypted with Argon2id and AES-256-GCM.
- User passwords are already hashed and per-user DEKs are already wrapped.
- SQLite encryption hooks already exist when a core passphrase is configured and SQLCipher is available.
- The current gaps are plaintext default DB behavior, plaintext file-backed personal content, plaintext desktop unlock artifacts, and docs drift about what is already encrypted.

## Already Done

- Encrypted vault export and import payloads are shipped.
- Password hashing and per-user DEK wrapping are shipped.
- Optional SQLCipher support for the SQLite Core is shipped.
- A per-user content encryption helper exists for future storage integration.
- `users/<id>/soul.md` now encrypts on write and rewrites legacy plaintext on first read.
- Desktop unlock tokens and serialized user state are no longer persisted across sessions in `localStorage`, and old values are purged.

## Still Missing

- Encrypted-by-default behavior for the local Core store.
- Encryption or removal of remaining plaintext file-backed personal content beyond `users/<id>/soul.md`.
- A final decision on whether `manifest.json` stays minimal plaintext metadata or moves under encryption.
- Clear migration, unlock, and failure states that prevent backend 500s during normal setup.

## Included

- Core passphrase bootstrap and unlock behavior.
- Encrypted-by-default local storage for personal data.
- Migration path for existing plaintext local data.
- Removal of plaintext desktop unlock artifacts from browser storage.
- Clear encryption status and failure handling.

## Not Included

- Cloud security posture or provider retention policy changes.
- Multi-user sharing or sync.
- Enterprise recovery or escrow.
- New provider key persistence features.

## Success Criteria

- [ ] Personal Core data is unreadable on disk without the passphrase.
- [ ] Existing plaintext local data migrates safely into the encrypted Core.
- [ ] Desktop auth no longer leaves reusable unlock artifacts in plaintext browser storage.
- [ ] Copying the Core to another machine and unlocking with the same passphrase works.
- [ ] Wrong-passphrase and setup failures produce explicit product errors instead of backend crashes.

## PRD

- [Encrypted Core v1](../../docs/prd/encrypted-core-v1.md)

---

_Version: v1-encrypted-core_
_PRD: [Encrypted Core v1](../../docs/prd/encrypted-core-v1.md)_
_Prior versions: None_
_Author: Julio Caesar_
_Created: 2026-03-14_
