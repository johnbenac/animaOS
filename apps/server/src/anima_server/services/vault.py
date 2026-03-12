from __future__ import annotations

import base64
import json
import os
import shutil
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any
from uuid import uuid4

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from anima_server.config import settings
from anima_server.models import User, UserKey
from anima_server.services.crypto import (
    ARGON2_MEMORY_COST_KIB,
    ARGON2_PARALLELISM,
    ARGON2_TIME_COST,
    AUTH_TAG_LENGTH,
    IV_LENGTH,
    KEY_LENGTH,
    SALT_LENGTH,
    derive_argon2id_key,
)

VAULT_VERSION = 2


def export_vault(db: Session, passphrase: str) -> dict[str, Any]:
    payload = {
        "version": VAULT_VERSION,
        "createdAt": datetime.now(UTC).isoformat(),
        "database": export_database_snapshot(db),
        "userFiles": read_data_snapshot(),
    }
    plaintext = json.dumps(payload)
    envelope = encrypt_string(plaintext, passphrase)
    vault = json.dumps(envelope)
    date_stamp = datetime.now().date().isoformat()
    return {
        "filename": f"anima-vault-{date_stamp}.vault.json",
        "vault": vault,
        "size": len(vault.encode("utf-8")),
    }


def import_vault(db: Session, vault: str, passphrase: str) -> dict[str, Any]:
    try:
        envelope = json.loads(vault)
    except json.JSONDecodeError as exc:
        raise ValueError("Vault payload is not valid JSON.") from exc

    plaintext = decrypt_string(envelope, passphrase)

    try:
        payload = json.loads(plaintext)
    except json.JSONDecodeError as exc:
        raise ValueError("Vault payload is not valid JSON.") from exc

    version = payload.get("version")
    if version != VAULT_VERSION:
        raise ValueError(
            f"Unsupported vault payload version: {version}. Supported version: {VAULT_VERSION}.",
        )

    database = payload.get("database")
    if not isinstance(database, dict):
        raise ValueError("Vault payload is missing the database snapshot.")

    user_files = payload.get("userFiles")
    if user_files is None:
        user_files = {}
    if not isinstance(user_files, dict):
        raise ValueError("Vault payload user files are invalid.")

    restore_database_snapshot(db, database)
    write_data_snapshot(user_files)

    restored_memory_files = sum(
        1
        for path in user_files
        if isinstance(path, str) and "/memory/" in path and path.endswith(".md")
    )
    restored_users = len(database.get("users", []))

    return {
        "restoredUsers": restored_users,
        "restoredMemoryFiles": restored_memory_files,
        "requiresReauth": True,
    }


def encrypt_string(plaintext: str, passphrase: str) -> dict[str, Any]:
    salt = random_bytes(SALT_LENGTH)
    iv = random_bytes(IV_LENGTH)
    key = derive_argon2id_key(passphrase, salt)
    encrypted = AESGCM(key).encrypt(iv, plaintext.encode("utf-8"), None)
    ciphertext, tag = encrypted[:-AUTH_TAG_LENGTH], encrypted[-AUTH_TAG_LENGTH:]
    return {
        "version": VAULT_VERSION,
        "createdAt": datetime.now(UTC).isoformat(),
        "payloadVersion": VAULT_VERSION,
        "kdf": {
            "name": "argon2id",
            "timeCost": ARGON2_TIME_COST,
            "memoryCostKiB": ARGON2_MEMORY_COST_KIB,
            "parallelism": ARGON2_PARALLELISM,
            "keyLength": KEY_LENGTH,
            "salt": base64.b64encode(salt).decode("ascii"),
        },
        "cipher": {
            "name": "aes-256-gcm",
            "iv": base64.b64encode(iv).decode("ascii"),
            "tag": base64.b64encode(tag).decode("ascii"),
        },
        "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
    }


def decrypt_string(envelope: dict[str, Any], passphrase: str) -> str:
    version = envelope.get("version")
    payload_version = envelope.get("payloadVersion")
    if version != VAULT_VERSION:
        raise ValueError(
            f"Unsupported vault version: {version}. Supported version: {VAULT_VERSION}.",
        )
    if payload_version != VAULT_VERSION:
        raise ValueError(
            f"Unsupported vault payload version: {payload_version}. Supported version: {VAULT_VERSION}.",
        )

    kdf = envelope.get("kdf")
    cipher = envelope.get("cipher")
    ciphertext_b64 = envelope.get("ciphertext")
    if (
        not isinstance(kdf, dict)
        or not isinstance(cipher, dict)
        or not isinstance(ciphertext_b64, str)
        or kdf.get("name") != "argon2id"
        or cipher.get("name") != "aes-256-gcm"
    ):
        raise ValueError("Vault payload format is invalid.")

    try:
        salt = base64.b64decode(str(kdf["salt"]))
        iv = base64.b64decode(str(cipher["iv"]))
        tag = base64.b64decode(str(cipher["tag"]))
        ciphertext = base64.b64decode(ciphertext_b64)
        key = derive_argon2id_key(
            passphrase,
            salt,
            time_cost=int(kdf["timeCost"]),
            memory_cost_kib=int(kdf["memoryCostKiB"]),
            parallelism=int(kdf["parallelism"]),
            key_length=int(kdf["keyLength"]),
        )
        plaintext = AESGCM(key).decrypt(iv, ciphertext + tag, None)
    except Exception as exc:  # noqa: BLE001
        raise ValueError("Failed to decrypt vault. Check the passphrase and payload.") from exc

    return plaintext.decode("utf-8")


def export_database_snapshot(db: Session) -> dict[str, list[dict[str, Any]]]:
    users = [serialize_user_record(user) for user in db.scalars(select(User)).all()]
    user_keys = [
        serialize_user_key_record(user_key)
        for user_key in db.scalars(select(UserKey)).all()
    ]
    return {
        "users": users,
        "userKeys": user_keys,
    }


def restore_database_snapshot(db: Session, snapshot: dict[str, Any]) -> None:
    users_payload = snapshot.get("users")
    user_keys_payload = snapshot.get("userKeys")
    if not isinstance(users_payload, list) or not isinstance(user_keys_payload, list):
        raise ValueError("Vault database snapshot is missing users or userKeys.")

    try:
        db.query(UserKey).delete()
        db.query(User).delete()

        for record in users_payload:
            if not isinstance(record, dict):
                raise ValueError("Vault user record is invalid.")
            db.add(
                User(
                    id=int(record["id"]),
                    username=str(record["username"]),
                    password_hash=str(record["password_hash"]),
                    display_name=str(record["display_name"]),
                    gender=coerce_optional_str(record.get("gender")),
                    age=coerce_optional_int(record.get("age")),
                    birthday=coerce_optional_str(record.get("birthday")),
                    created_at=parse_optional_datetime(record.get("created_at")),
                    updated_at=parse_optional_datetime(record.get("updated_at")),
                )
            )

        for record in user_keys_payload:
            if not isinstance(record, dict):
                raise ValueError("Vault user key record is invalid.")
            db.add(
                UserKey(
                    id=int(record["id"]),
                    user_id=int(record["user_id"]),
                    kdf_salt=str(record["kdf_salt"]),
                    kdf_time_cost=int(record["kdf_time_cost"]),
                    kdf_memory_cost_kib=int(record["kdf_memory_cost_kib"]),
                    kdf_parallelism=int(record["kdf_parallelism"]),
                    kdf_key_length=int(record["kdf_key_length"]),
                    wrap_iv=str(record["wrap_iv"]),
                    wrap_tag=str(record["wrap_tag"]),
                    wrapped_dek=str(record["wrapped_dek"]),
                    created_at=parse_optional_datetime(record.get("created_at")),
                    updated_at=parse_optional_datetime(record.get("updated_at")),
                )
            )

        db.flush()
        reset_identity_sequences(db)
        db.commit()
    except Exception:
        db.rollback()
        raise


def read_data_snapshot() -> dict[str, str]:
    root = settings.data_dir
    if not root.exists():
        return {}

    snapshot: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        snapshot[path.relative_to(root).as_posix()] = path.read_text(encoding="utf-8")
    return snapshot


def write_data_snapshot(user_files: dict[str, Any]) -> None:
    root = settings.data_dir
    root.parent.mkdir(parents=True, exist_ok=True)
    staging_root = root.parent / f"{root.name}.import-{uuid4().hex}"
    backup_root = root.parent / f"{root.name}.backup-{uuid4().hex}"
    staging_root.mkdir(parents=True, exist_ok=True)

    try:
        for relative_path, content in user_files.items():
            safe_path = sanitize_relative_path(relative_path)
            target = staging_root / safe_path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(str(content), encoding="utf-8")

        if backup_root.exists():
            shutil.rmtree(backup_root, ignore_errors=True)
        if root.exists():
            root.rename(backup_root)
        staging_root.rename(root)
        shutil.rmtree(backup_root, ignore_errors=True)
    except Exception:
        shutil.rmtree(staging_root, ignore_errors=True)
        if backup_root.exists() and not root.exists():
            backup_root.rename(root)
        raise


def sanitize_relative_path(raw_path: Any) -> Path:
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise ValueError("Vault file path is invalid.")
    normalized = PurePosixPath(raw_path)
    if normalized.is_absolute() or ".." in normalized.parts:
        raise ValueError("Vault file path is invalid.")
    return Path(*normalized.parts)


def serialize_user_record(user: User) -> dict[str, Any]:
    return {
        "id": user.id,
        "username": user.username,
        "password_hash": user.password_hash,
        "display_name": user.display_name,
        "gender": user.gender,
        "age": user.age,
        "birthday": user.birthday,
        "created_at": serialize_optional_datetime(user.created_at),
        "updated_at": serialize_optional_datetime(user.updated_at),
    }


def serialize_user_key_record(user_key: UserKey) -> dict[str, Any]:
    return {
        "id": user_key.id,
        "user_id": user_key.user_id,
        "kdf_salt": user_key.kdf_salt,
        "kdf_time_cost": user_key.kdf_time_cost,
        "kdf_memory_cost_kib": user_key.kdf_memory_cost_kib,
        "kdf_parallelism": user_key.kdf_parallelism,
        "kdf_key_length": user_key.kdf_key_length,
        "wrap_iv": user_key.wrap_iv,
        "wrap_tag": user_key.wrap_tag,
        "wrapped_dek": user_key.wrapped_dek,
        "created_at": serialize_optional_datetime(user_key.created_at),
        "updated_at": serialize_optional_datetime(user_key.updated_at),
    }


def serialize_optional_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat()


def parse_optional_datetime(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise ValueError("Vault timestamp is invalid.")
    return datetime.fromisoformat(value)


def coerce_optional_str(value: Any) -> str | None:
    if value is None:
        return None
    return str(value)


def coerce_optional_int(value: Any) -> int | None:
    if value is None:
        return None
    return int(value)


def reset_identity_sequences(db: Session) -> None:
    bind = db.get_bind()
    if bind is None or bind.dialect.name != "postgresql":
        return

    for table_name in ("users", "user_keys"):
        db.execute(
            text(
                f"""
                SELECT setval(
                    pg_get_serial_sequence('{table_name}', 'id'),
                    COALESCE((SELECT MAX(id) FROM {table_name}), 1),
                    COALESCE((SELECT MAX(id) FROM {table_name}), 0) > 0
                )
                """,
            )
        )


def random_bytes(length: int) -> bytes:
    return os.urandom(length)
