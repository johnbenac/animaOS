from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from anima_server.api.deps.unlock import require_unlocked_user
from anima_server.db import get_db
from anima_server.services.crypto import (
    ENCRYPTED_TEXT_PREFIX,
    decrypt_text_with_dek,
    encrypt_text_with_dek,
)
from anima_server.services.data_crypto import require_dek_for_user
from anima_server.services.storage import get_user_data_dir

router = APIRouter(prefix="/api/soul", tags=["soul"])

SOUL_FILENAME = "soul.md"


class SoulResponse(BaseModel):
    content: str
    path: str


class SoulUpdateRequest(BaseModel):
    content: str = Field(min_length=1)


def _soul_path(user_id: int) -> Path:
    return get_user_data_dir(user_id) / SOUL_FILENAME


def _read_and_migrate_soul(user_id: int, path: Path) -> str:
    if not path.exists():
        return ""

    dek = require_dek_for_user(user_id)
    raw_content = path.read_text(encoding="utf-8")
    content = decrypt_text_with_dek(raw_content, dek)

    # Transparently rewrite legacy plaintext files on first successful read.
    if raw_content and not raw_content.startswith(f"{ENCRYPTED_TEXT_PREFIX}:"):
        path.write_text(encrypt_text_with_dek(content, dek), encoding="utf-8")

    return content


@router.get("/{user_id}", response_model=SoulResponse)
async def get_soul(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
) -> SoulResponse:
    require_unlocked_user(request, user_id)
    path = _soul_path(user_id)
    content = _read_and_migrate_soul(user_id, path)
    return SoulResponse(content=content, path=str(path))


@router.put("/{user_id}")
async def update_soul(
    user_id: int,
    payload: SoulUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    require_unlocked_user(request, user_id)
    path = _soul_path(user_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    dek = require_dek_for_user(user_id)
    path.write_text(encrypt_text_with_dek(payload.content, dek), encoding="utf-8")
    return {"status": "updated", "path": str(path)}
