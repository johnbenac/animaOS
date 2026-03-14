from __future__ import annotations

import pytest

from anima_server.config import settings
from anima_server.services.agent.embeddings import generate_embedding
from anima_server.services.agent.llm import LLMConfigError, build_provider_headers


@pytest.mark.asyncio
async def test_generate_embedding_skips_openrouter_without_api_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original_provider = settings.agent_provider
    original_api_key = settings.agent_api_key
    embed_calls: list[str] = []

    async def fake_embed(text: str) -> list[float]:
        embed_calls.append(text)
        return [0.1, 0.2, 0.3]

    try:
        settings.agent_provider = "openrouter"
        settings.agent_api_key = ""
        monkeypatch.setattr(
            "anima_server.services.agent.embeddings._embed_openai_compatible",
            fake_embed,
        )

        result = await generate_embedding("hello")
    finally:
        settings.agent_provider = original_provider
        settings.agent_api_key = original_api_key

    assert result is None
    assert embed_calls == []


def test_build_provider_headers_rejects_openrouter_without_api_key() -> None:
    original_api_key = settings.agent_api_key

    try:
        settings.agent_api_key = ""
        with pytest.raises(
            LLMConfigError,
            match="ANIMA_AGENT_API_KEY is required",
        ):
            build_provider_headers("openrouter")
    finally:
        settings.agent_api_key = original_api_key
