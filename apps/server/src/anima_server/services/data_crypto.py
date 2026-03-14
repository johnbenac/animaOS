from __future__ import annotations

from anima_server.services.crypto import decrypt_text_with_dek, encrypt_text_with_dek
from anima_server.services.sessions import get_active_dek


def maybe_encrypt_for_user(user_id: int, plaintext: str) -> str:
    dek = get_active_dek(user_id)
    if dek is None:
        return plaintext
    return encrypt_text_with_dek(plaintext, dek)


def maybe_decrypt_for_user(user_id: int, value: str) -> str:
    dek = get_active_dek(user_id)
    if dek is None:
        return value
    return decrypt_text_with_dek(value, dek)


def encrypt_field(user_id: int, value: str | None) -> str | None:
    """Encrypt a text field if a DEK is active, otherwise return as-is."""
    if not value:
        return value
    return maybe_encrypt_for_user(user_id, value)


def decrypt_field(user_id: int, value: str | None) -> str:
    """Decrypt a text field if encrypted, return plaintext as-is. Returns '' for None."""
    if not value:
        return value or ""
    return maybe_decrypt_for_user(user_id, value)


def require_dek_for_user(user_id: int) -> bytes:
    dek = get_active_dek(user_id)
    if dek is None:
        raise ValueError("Session key is locked. Please sign in again.")
    return dek
