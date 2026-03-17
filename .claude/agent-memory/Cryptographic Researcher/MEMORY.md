# Cryptographic Researcher Memory

## Project Encryption Architecture (Verified 2026-03-17)

### Key Files
- `apps/server/src/anima_server/services/crypto.py` -- KEK/DEK key chain, Argon2id derivation, AES-256-GCM field encryption
- `apps/server/src/anima_server/services/data_crypto.py` -- field-level encrypt/decrypt wrappers with AAD support
- `apps/server/src/anima_server/services/vault.py` -- vault export/import, envelope encryption, version migration
- `apps/server/src/anima_server/services/sessions.py` -- DEK session store, 24h TTL, ctypes-based key zeroing
- `apps/server/src/anima_server/services/auth.py` -- password hashing (argon2), user creation with DEK generation
- `apps/server/src/anima_server/services/core.py` -- manifest, encryption mode detection, single-writer lock
- `apps/server/src/anima_server/db/session.py` -- SQLCipher engine setup, passphrase injection via PRAGMA key
- `apps/server/src/anima_server/models/user_key.py` -- wrapped DEK storage model

### Crypto Parameters (Current)
- Argon2id: time_cost=3, memory_cost=64MiB, parallelism=1, key_length=32, salt=16 bytes
- AES-256-GCM: IV=12 bytes, auth_tag=16 bytes
- DEK: 32 bytes random (os.urandom), wrapped by KEK
- Session TTL: 24 hours
- Vault version: 2, with AAD context binding

### Critical Findings
- **AAD not used in practice**: `ef()` calls throughout codebase omit `table=` and `field=` params, so AAD is always None (enc1 prefix). AAD infrastructure exists but is dormant.
- **SQLCipher uses default cipher settings**: No PRAGMA cipher_page_size, kdf_iter, or cipher_compatibility set. Relies on sqlcipher3 defaults.
- **Encryption is opt-in**: `core_passphrase` defaults to empty string. `core_require_encryption` defaults to True but passphrase must be set.
- **Succession protocol not implemented**: Only referenced in thesis docs. No code exists.
- **User files outside encrypted boundary**: `users/{id}/` directory contains plaintext files (e.g., memory/*.md) that survive outside SQLCipher/field encryption.
- **Key zeroing is best-effort**: Python bytes are immutable; ctypes.memset approach is defense-in-depth, not guaranteed.
- **No compression before vault encryption**: Vault JSON is encrypted directly without compression.

### Thesis Documents
- `docs/thesis/whitepaper.md` -- master document
- `docs/thesis/portable-core.md` -- encryption architecture, key chain, vault, forward secrecy
- `docs/thesis/inner-life.md` -- self-model, reflection, emotional awareness
- `docs/thesis/succession-protocol.md` -- dead man switch, two-key architecture
- `docs/thesis/roadmap.md` -- implementation phases

See also: [crypto-audit-findings.md](crypto-audit-findings.md)
