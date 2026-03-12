from __future__ import annotations

from dataclasses import dataclass
import base64
import os

from argon2.low_level import Type, hash_secret_raw
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ARGON2_TIME_COST = 3
ARGON2_MEMORY_COST_KIB = 64 * 1024
ARGON2_PARALLELISM = 1
KEY_LENGTH = 32
SALT_LENGTH = 16
IV_LENGTH = 12
AUTH_TAG_LENGTH = 16
ENCRYPTED_TEXT_PREFIX = "enc1"


@dataclass(frozen=True, slots=True)
class WrappedDekRecord:
    kdf_salt: str
    kdf_time_cost: int
    kdf_memory_cost_kib: int
    kdf_parallelism: int
    kdf_key_length: int
    wrap_iv: str
    wrap_tag: str
    wrapped_dek: str


def derive_argon2id_key(
    passphrase: str,
    salt: bytes,
    *,
    time_cost: int = ARGON2_TIME_COST,
    memory_cost_kib: int = ARGON2_MEMORY_COST_KIB,
    parallelism: int = ARGON2_PARALLELISM,
    key_length: int = KEY_LENGTH,
) -> bytes:
    return hash_secret_raw(
        secret=passphrase.encode("utf-8"),
        salt=salt,
        time_cost=time_cost,
        memory_cost=memory_cost_kib,
        parallelism=parallelism,
        hash_len=key_length,
        type=Type.ID,
    )


def create_wrapped_dek(passphrase: str) -> tuple[bytes, WrappedDekRecord]:
    dek = os.urandom(KEY_LENGTH)
    return dek, wrap_dek(passphrase, dek)


def wrap_dek(passphrase: str, dek: bytes) -> WrappedDekRecord:
    salt = os.urandom(SALT_LENGTH)
    iv = os.urandom(IV_LENGTH)
    kek = derive_argon2id_key(passphrase, salt)
    encrypted = AESGCM(kek).encrypt(iv, dek, None)
    ciphertext, tag = encrypted[:-AUTH_TAG_LENGTH], encrypted[-AUTH_TAG_LENGTH:]

    return WrappedDekRecord(
        kdf_salt=base64.b64encode(salt).decode("ascii"),
        kdf_time_cost=ARGON2_TIME_COST,
        kdf_memory_cost_kib=ARGON2_MEMORY_COST_KIB,
        kdf_parallelism=ARGON2_PARALLELISM,
        kdf_key_length=KEY_LENGTH,
        wrap_iv=base64.b64encode(iv).decode("ascii"),
        wrap_tag=base64.b64encode(tag).decode("ascii"),
        wrapped_dek=base64.b64encode(ciphertext).decode("ascii"),
    )


def unwrap_dek(passphrase: str, record: WrappedDekRecord) -> bytes:
    salt = base64.b64decode(record.kdf_salt)
    iv = base64.b64decode(record.wrap_iv)
    tag = base64.b64decode(record.wrap_tag)
    ciphertext = base64.b64decode(record.wrapped_dek)
    kek = derive_argon2id_key(
        passphrase,
        salt,
        time_cost=record.kdf_time_cost,
        memory_cost_kib=record.kdf_memory_cost_kib,
        parallelism=record.kdf_parallelism,
        key_length=record.kdf_key_length,
    )
    return AESGCM(kek).decrypt(iv, ciphertext + tag, None)


def encrypt_text_with_dek(plaintext: str, dek: bytes) -> str:
    iv = os.urandom(IV_LENGTH)
    encrypted = AESGCM(dek).encrypt(iv, plaintext.encode("utf-8"), None)
    ciphertext, tag = encrypted[:-AUTH_TAG_LENGTH], encrypted[-AUTH_TAG_LENGTH:]
    return ":".join(
        [
            ENCRYPTED_TEXT_PREFIX,
            base64.b64encode(iv).decode("ascii"),
            base64.b64encode(tag).decode("ascii"),
            base64.b64encode(ciphertext).decode("ascii"),
        ]
    )


def decrypt_text_with_dek(serialized: str, dek: bytes) -> str:
    if not serialized.startswith(f"{ENCRYPTED_TEXT_PREFIX}:"):
        return serialized
    prefix, iv_b64, tag_b64, ciphertext_b64 = serialized.split(":", 3)
    if prefix != ENCRYPTED_TEXT_PREFIX:
        raise ValueError("Invalid encrypted payload format.")
    iv = base64.b64decode(iv_b64)
    tag = base64.b64decode(tag_b64)
    ciphertext = base64.b64decode(ciphertext_b64)
    plaintext = AESGCM(dek).decrypt(iv, ciphertext + tag, None)
    return plaintext.decode("utf-8")
