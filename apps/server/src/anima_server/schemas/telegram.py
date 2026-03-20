from __future__ import annotations

from pydantic import BaseModel, Field


class TelegramLinkRequest(BaseModel):
    chatId: int
    userId: int = Field(ge=0)
    linkSecret: str | None = None


class TelegramUnlinkRequest(BaseModel):
    chatId: int


class TelegramLinkResponse(BaseModel):
    chatId: int
    userId: int
