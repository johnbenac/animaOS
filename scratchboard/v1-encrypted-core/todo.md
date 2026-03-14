# Encrypted Core Todo

## Audit and Scope

- [ ] Confirm the canonical encrypted-at-rest policy for Core data, bootstrap metadata, and desktop session artifacts.
- [ ] Reconcile docs that currently promise encrypted-by-default behavior with the current implementation.

## Core Bootstrap and DB Encryption

- [ ] Define first-run and unlock UX for setting and entering the Core passphrase.
- [ ] Make the primary local Core store encrypted by default or fail fast when encryption prerequisites are missing.
- [ ] Add explicit startup and API errors for wrong passphrase, uninitialized store, and missing migration.

## File-Backed Content and Migration

- [x] Start `users/<id>/soul.md` migration with encrypted writes and transparent plaintext-to-encrypted rewrite on first read.
- [ ] Inventory all filesystem-backed personal data under `.anima/` and decide whether each item is encrypted in place or moved into the DB.
- [ ] Encrypt or eliminate plaintext user files, including `users/<id>/soul.md` and related per-user content.
- [ ] Decide whether `manifest.json` becomes encrypted or remains minimal non-personal bootstrap metadata.
- [ ] Build a one-time migration from existing plaintext local data into the encrypted Core.
- [ ] Verify plaintext remnants are removed after successful migration.

## Desktop Session Handling

- [x] Remove plaintext `anima_user` and `anima_unlock_token` persistence from browser `localStorage`.
- [ ] Choose the replacement session model for desktop unlock continuity.
- [ ] Verify logout, restart, and unlock flows behave predictably after the storage change.

## Verification and Docs

- [ ] Add automated tests for encrypted DB open, migration, portability, and wrong-passphrase failures.
- [ ] Run manual smoke checks for auth, chat, memory, soul, tasks, and vault export/import after migration.
- [ ] Update product and technical docs to match the shipped security model.

---

_Version: v1-encrypted-core_
_PRD: [Encrypted Core v1](../../docs/prd/encrypted-core-v1.md)_
_Prior versions: None_
_Author: Julio Caesar_
_Created: 2026-03-14_
