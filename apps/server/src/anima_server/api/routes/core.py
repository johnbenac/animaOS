from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from anima_server.api.deps.unlock import require_unlocked_session
from anima_server.config import settings
from anima_server.db import get_db
from anima_server.schemas.core import CoreStatusResponse

router = APIRouter(prefix="/api/core", tags=["core"])


def _sqlcipher_available() -> bool:
    try:
        import sqlcipher3  # noqa: F401
        return True
    except ImportError:
        return False


@router.get("/status", response_model=CoreStatusResponse)
def get_core_status(
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    require_unlocked_session(request)
    has_passphrase = bool(settings.core_passphrase)
    sqlcipher_installed = _sqlcipher_available()

    return {
        "encryption_active": has_passphrase and sqlcipher_installed,
        "sqlcipher_available": sqlcipher_installed,
        "passphrase_set": has_passphrase,
    }
