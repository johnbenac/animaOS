from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from anima_server.api.deps.unlock import require_unlocked_user
from anima_server.config import settings
from anima_server.db import get_db

router = APIRouter(prefix="/api/config", tags=["config"])


class ProviderInfo(BaseModel):
    name: str
    defaultModel: str
    requiresApiKey: bool


class AgentConfigResponse(BaseModel):
    provider: str
    model: str
    ollamaUrl: str | None = None
    hasApiKey: bool = False
    systemPrompt: str | None = None


class AgentConfigUpdateRequest(BaseModel):
    provider: str
    model: str
    apiKey: str | None = None
    ollamaUrl: str | None = None
    systemPrompt: str | None = None


AVAILABLE_PROVIDERS: list[ProviderInfo] = [
    ProviderInfo(name="scaffold", defaultModel="scaffold", requiresApiKey=False),
    ProviderInfo(name="ollama", defaultModel="llama3.2", requiresApiKey=False),
    ProviderInfo(name="openai", defaultModel="gpt-4o-mini", requiresApiKey=True),
    ProviderInfo(name="anthropic", defaultModel="claude-sonnet-4-20250514", requiresApiKey=True),
]


@router.get("/providers", response_model=list[ProviderInfo])
async def get_providers() -> list[ProviderInfo]:
    return AVAILABLE_PROVIDERS


@router.get("/{user_id}", response_model=AgentConfigResponse)
async def get_config(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
) -> AgentConfigResponse:
    require_unlocked_user(request, user_id)
    return AgentConfigResponse(
        provider=settings.agent_provider,
        model=settings.agent_model,
        ollamaUrl=settings.agent_base_url or None,
        hasApiKey=bool(settings.agent_api_key),
    )


@router.put("/{user_id}")
async def update_config(
    user_id: int,
    payload: AgentConfigUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    require_unlocked_user(request, user_id)

    settings.agent_provider = payload.provider
    settings.agent_model = payload.model
    if payload.apiKey is not None:
        settings.agent_api_key = payload.apiKey
    if payload.ollamaUrl is not None:
        settings.agent_base_url = payload.ollamaUrl

    from anima_server.services.agent import invalidate_agent_runtime_cache

    invalidate_agent_runtime_cache()

    return {"status": "updated"}
