---
title: "Vault Audit: Thesis vs. Implementation"
date: 2026-03-17
status: active
audited_files:
  - apps/server/src/anima_server/services/vault.py
  - apps/server/src/anima_server/services/crypto.py
  - apps/server/src/anima_server/services/data_crypto.py
  - apps/server/src/anima_server/services/sessions.py
  - apps/server/src/anima_server/services/core.py
  - apps/server/src/anima_server/api/routes/vault.py
  - apps/server/src/anima_server/schemas/vault.py
  - apps/server/tests/test_vault.py
  - apps/server/tests/test_crypto.py
  - apps/server/tests/test_data_crypto.py
thesis_documents:
  - docs/thesis/whitepaper.md
  - docs/thesis/portable-core.md
  - docs/thesis/inner-life.md
  - docs/thesis/succession-protocol.md
  - docs/thesis/roadmap.md
---

# Vault Audit: Thesis vs. Implementation

## What's Working Well

These thesis commitments are implemented and solid:

| Thesis Claim | Implementation | File |
|---|---|---|
| AES-256-GCM vault encryption | `encrypt_string()` / `decrypt_string()` | `services/vault.py` |
| Argon2id key derivation (64 MB memory-hard) | `ARGON2_MEMORY_COST_KIB = 64 * 1024`, time_cost=3 | `services/crypto.py` |
| KEK/DEK key chain | `create_wrapped_dek()`, `wrap_dek()`, `unwrap_dek()` | `services/crypto.py` |
| Self-describing vault envelope | KDF params embedded in envelope JSON | `services/vault.py` |
| Pre-decryption integrity check | SHA-256 hash on ciphertext (v2+) | `services/vault.py` |
| DEK zeroing on session end | `_zero_dek()` via `ctypes.memset` | `services/sessions.py` |
| Session TTL (24h max DEK residency) | Expired sessions purged, DEK zeroed | `services/sessions.py` |
| Single-writer advisory lock | `core.lock` file with PID + stale detection | `services/core.py` |
| Vault version migration chain | Sequential migrators, refuses unknown future versions | `services/vault.py` |
| Manifest with structural metadata | core_id, version, schema_version, encryption_mode | `services/core.py` |
| Passphrase-only portability | Vault file + passphrase restores on any machine | `services/vault.py` |
| Field-level encryption with AAD | `enc2:` prefix binds ciphertext to `table:user_id:field` | `services/data_crypto.py` |
| Scoped export (full vs memories) | `export_vault(scope="full"\|"memories")` | `services/vault.py` |
| Vector index rebuild on import | `_rebuild_vector_indices()` after restore | `services/vault.py` |

---

## Critical Gaps

### 1. FIXED — Vault exports field-level ciphertext without decrypting

**Severity: CRITICAL** | **Status: FIXED**

Serializers in `export_database_snapshot()` read raw column values. When fields are
encrypted with the user's DEK (via `data_crypto.ef()`), the vault payload contained
`enc2:iv:tag:ciphertext` strings, then encrypted again under the vault passphrase.

On import to a different machine (or after password change), the DEK changes. The
imported field-level ciphertext was bound to the old DEK and could not be decrypted.
This silently corrupted all field-encrypted data on cross-machine transfer.

**Thesis reference**: portable-core.md — "Copy to USB, plug into new machine, enter
passphrase, AI wakes up with full memory and identity intact."

**Fix applied**: Vault export now decrypts all field-level encrypted values using the
current session DEK before serialization. The vault envelope encrypts plaintext data.
On import, values are re-encrypted with the importing user's active DEK.

### 2. FIXED — No AAD on vault-level encryption

**Severity: HIGH** | **Status: FIXED**

`encrypt_string()` passed `None` as AAD to `AESGCM.encrypt()`. The thesis
(portable-core.md section 3.4) requires context binding: "Every encrypted field must be
bound to its context... Without this binding, encrypted blobs can be silently swapped."

**Fix applied**: Vault encryption now uses AAD of the form
`anima-vault:v{version}:{scope}` to bind the ciphertext to its export context. Stored
in the envelope as `aad_b64` for decryption. Backwards-compatible: envelopes without
`aad_b64` decrypt with `None` AAD (legacy behavior).

### 3. Encryption is not the default

**Severity: HIGH** | **Status: OPEN**

The manifest shows `"encryption_mode": "none"`. The thesis states encryption must be
the default, not opt-in. Currently requires `ANIMA_CORE_PASSPHRASE` env var and
optional SQLCipher installation. This is a larger architectural change tracked in the
roadmap as Phase 1.

### 4. FIXED — Manifest not included in vault export

**Severity: MEDIUM-HIGH** | **Status: FIXED**

The vault snapshot contained table data and user files but not `manifest.json`. On
import to a new machine, the Core lost its birth identity (core_id, created_at).

**Fix applied**: `manifest.json` is now included in vault exports under a `manifest`
key. On import, `core_id` and `created_at` are restored from the vault manifest,
preserving the Core's identity across transfers.

---

## Functional Gaps

### 5. No "anonymized" transfer scope

**Severity: MEDIUM** | **Status: OPEN**

The thesis defines three scopes: `full`, `memories_only`, `anonymized`. The code only
supports `full` and `memories`. The anonymized scope (strip PII, preserve personality)
is not implemented. This is needed for the succession protocol.

### 6. No succession protocol

**Severity: MEDIUM** | **Status: OPEN (future)**

No `succession_configs` or `succession_beneficiaries` tables. No dead man switch, no
two-key architecture for succession. The succession-protocol.md defines this fully but
it depends on encrypted-by-default Core (item 3) being delivered first.

### 7. FIXED — No import scope validation (destructive memories-only import)

**Severity: MEDIUM** | **Status: FIXED**

Importing a `memories`-scoped vault would delete all conversation data and replace it
with empty lists since those tables weren't in the export.

**Fix applied**: `restore_database_snapshot()` now checks the vault scope and only
deletes/restores the tables that were included in the export. Conversation tables are
preserved when importing a memories-only vault.

### 8. No selective import

**Severity: MEDIUM** | **Status: OPEN**

The thesis requires partial import (e.g., import only self-model from a vault). Current
import is all-or-nothing within a scope. This is a future enhancement.

### 9. No vault compression

**Severity: LOW** | **Status: OPEN**

The thesis lists compression for large Cores. Vault is JSON then encrypted with no
compression step. Will matter after years of conversation history.

### 10. No forward secrecy for vault exports

**Severity: LOW** | **Status: OPEN (thesis acknowledges as open question)**

portable-core.md section 3.6 discusses ephemeral key components to prevent retroactive
decryption. The thesis itself notes this as an open design question with usability
tradeoffs.

### 11. Password hash and DEK not re-keyed on import

**Severity: MEDIUM** | **Status: OPEN**

The vault restores the original `password_hash` and `wrapped_dek`. If the importing
user has different credentials, they must know the original password. The succession
protocol will need re-keying support (new credentials wrap the same DEK).

### 12. Legacy TS vault code

**Severity: LOW** | **Status: OPEN**

`apps/api/src/routes/vault/` still contains TypeScript vault handlers from the legacy
backend. Dead code that could confuse contributors.
