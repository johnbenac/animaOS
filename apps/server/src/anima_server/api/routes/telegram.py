from __future__ import annotations

import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from anima_server.api.deps.unlock import require_unlocked_session
from anima_server.db import get_db
from anima_server.models import TelegramLink, User
from anima_server.schemas.telegram import (
    TelegramLinkRequest,
    TelegramLinkResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/telegram", tags=["telegram"])


@router.post("/link", response_model=TelegramLinkResponse, status_code=201)
def link_telegram(
    payload: TelegramLinkRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> TelegramLinkResponse:
    require_unlocked_session(request)

    link_secret = os.environ.get("TELEGRAM_LINK_SECRET")
    if link_secret and (not payload.linkSecret or payload.linkSecret != link_secret):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid link secret.",
        )

    user = db.get(User, payload.userId)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User {payload.userId} not found.",
        )

    # Remove existing links for this chat_id or user_id (one-to-one mapping)
    for existing in db.scalars(
        select(TelegramLink).where(
            (TelegramLink.chat_id == payload.chatId) | (TelegramLink.user_id == payload.userId)
        )
    ).all():
        db.delete(existing)
    db.flush()

    link = TelegramLink(chat_id=payload.chatId, user_id=payload.userId)
    db.add(link)
    db.commit()

    return TelegramLinkResponse(chatId=payload.chatId, userId=payload.userId)


@router.get("/link", response_model=TelegramLinkResponse)
def lookup_telegram(
    request: Request,
    chatId: int = Query(),
    db: Session = Depends(get_db),
) -> TelegramLinkResponse:
    require_unlocked_session(request)

    link = db.scalar(select(TelegramLink).where(TelegramLink.chat_id == chatId))
    if link is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No link found for this chat.",
        )
    return TelegramLinkResponse(chatId=link.chat_id, userId=link.user_id)


@router.delete("/link")
def unlink_telegram(
    request: Request,
    chatId: int = Query(),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    require_unlocked_session(request)

    link = db.scalar(select(TelegramLink).where(TelegramLink.chat_id == chatId))
    if link:
        db.delete(link)
        db.commit()

    return {"status": "unlinked"}
