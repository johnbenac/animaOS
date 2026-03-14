"""Vector embedding support for semantic memory search.

Generates embeddings via LLM providers and stores them in both:
- ChromaDB (for fast HNSW-indexed similarity search)
- MemoryItem.embedding_json (for vault export/import portability)

All supported providers (ollama, openrouter, vllm) expose an
OpenAI-compatible /v1/embeddings endpoint, so we use a single
httpx-based implementation for all of them.
"""

from __future__ import annotations

import json
import logging
import math
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from anima_server.config import settings
from anima_server.models import MemoryItem
from anima_server.services.agent.llm import (
    SUPPORTED_PROVIDERS,
    resolve_base_url,
    build_provider_headers,
)

logger = logging.getLogger(__name__)

# Default embedding models per provider.  Users can override via
# ANIMA_AGENT_EXTRACTION_MODEL.
_DEFAULT_EMBEDDING_MODELS: dict[str, str] = {
    "ollama": "nomic-embed-text",
    "openrouter": "openai/text-embedding-3-small",
    "vllm": "text-embedding-3-small",
}


def _resolve_embedding_model() -> str:
    """Return the embedding model to use, preferring the user-configured one."""
    configured = settings.agent_extraction_model.strip()
    if configured:
        return configured
    return _DEFAULT_EMBEDDING_MODELS.get(settings.agent_provider, "nomic-embed-text")


def _resolve_embedding_base_url() -> str:
    """Resolve the base URL for embeddings.

    For ollama, the native /api/embed endpoint is used instead of the
    OpenAI-compatible /v1/embeddings because ollama's /v1/embeddings
    may not be available in older versions.
    """
    provider = settings.agent_provider
    return resolve_base_url(provider)


async def generate_embedding(text: str) -> list[float] | None:
    """Generate an embedding vector for the given text using the configured provider."""
    provider = settings.agent_provider

    if provider == "scaffold":
        return None

    if provider not in SUPPORTED_PROVIDERS:
        return None

    try:
        if provider == "ollama":
            return await _embed_ollama(text)
        # openrouter, vllm — all OpenAI-compatible
        return await _embed_openai_compatible(text)
    except Exception:  # noqa: BLE001
        logger.exception("Embedding generation failed for provider %s", provider)
        return None


async def _embed_openai_compatible(text: str) -> list[float] | None:
    """Generate embeddings via any OpenAI-compatible /v1/embeddings endpoint."""
    import httpx

    base_url = _resolve_embedding_base_url()
    model = _resolve_embedding_model()
    headers = build_provider_headers(settings.agent_provider)
    headers["Content-Type"] = "application/json"

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{base_url}/embeddings",
            headers=headers,
            json={"model": model, "input": [text]},
        )
        resp.raise_for_status()
        data = resp.json()
        entries = data.get("data", [])
        if entries and isinstance(entries[0], dict):
            embedding = entries[0].get("embedding")
            if isinstance(embedding, list):
                return embedding
        return None


async def _embed_ollama(text: str) -> list[float] | None:
    """Generate embeddings via ollama's native /api/embed endpoint."""
    import httpx

    # For ollama, use the raw base URL (without /v1 suffix)
    configured = settings.agent_base_url.strip()
    base_url = configured if configured else "http://127.0.0.1:11434"
    # Strip /v1 suffix if present (resolve_base_url adds it for chat)
    base_url = base_url.removesuffix("/v1")
    model = _resolve_embedding_model()

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{base_url}/api/embed",
            json={"model": model, "input": text},
        )
        resp.raise_for_status()
        data = resp.json()
        embeddings = data.get("embeddings", [])
        if embeddings and isinstance(embeddings[0], list):
            return embeddings[0]
        return None


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    if len(a) != len(b) or not a:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


async def semantic_search(
    db: Session,
    *,
    user_id: int,
    query: str,
    limit: int = 10,
    similarity_threshold: float = 0.3,
) -> list[tuple[MemoryItem, float]]:
    """Search memory items by semantic similarity using ChromaDB.

    Falls back to brute-force cosine over embedding_json if ChromaDB has no data.
    """
    query_embedding = await generate_embedding(query)
    if query_embedding is None:
        return []

    # Try ChromaDB first (fast, indexed)
    try:
        from anima_server.services.agent.vector_store import search_similar

        chroma_results = search_similar(
            user_id,
            query_embedding=query_embedding,
            limit=limit,
        )
        if chroma_results:
            # Resolve to actual MemoryItem objects
            item_ids = [r["id"] for r in chroma_results if r["similarity"] >= similarity_threshold]
            if item_ids:
                items_by_id = {
                    item.id: item
                    for item in db.scalars(
                        select(MemoryItem).where(MemoryItem.id.in_(item_ids))
                    ).all()
                }
                results: list[tuple[MemoryItem, float]] = []
                for r in chroma_results:
                    if r["similarity"] >= similarity_threshold and r["id"] in items_by_id:
                        results.append((items_by_id[r["id"]], r["similarity"]))
                return results[:limit]
    except Exception:  # noqa: BLE001
        logger.debug("ChromaDB search failed, falling back to brute-force")

    # Fallback: brute-force over embedding_json column
    items = list(
        db.scalars(
            select(MemoryItem).where(
                MemoryItem.user_id == user_id,
                MemoryItem.superseded_by.is_(None),
                MemoryItem.embedding_json.isnot(None),
            )
        ).all()
    )

    scored: list[tuple[MemoryItem, float]] = []
    for item in items:
        item_embedding = _parse_embedding(item.embedding_json)
        if item_embedding is None:
            continue
        sim = cosine_similarity(query_embedding, item_embedding)
        if sim >= similarity_threshold:
            scored.append((item, sim))

    scored.sort(key=lambda pair: pair[1], reverse=True)
    return scored[:limit]


async def embed_memory_item(
    db: Session,
    item: MemoryItem,
) -> bool:
    """Generate and store an embedding for a single memory item.

    Stores in both the SQLite JSON column (for portability) and ChromaDB (for search).
    Returns True if successful.
    """
    embedding = await generate_embedding(item.content)
    if embedding is None:
        return False

    # Store in SQLite for vault export/import
    item.embedding_json = embedding
    db.flush()

    # Store in ChromaDB for fast search
    try:
        from anima_server.services.agent.vector_store import upsert_memory

        upsert_memory(
            item.user_id,
            item_id=item.id,
            content=item.content,
            embedding=embedding,
            category=item.category,
            importance=item.importance,
        )
    except Exception:  # noqa: BLE001
        logger.debug("Failed to upsert item %d into ChromaDB", item.id)

    return True


async def backfill_embeddings(
    db: Session,
    *,
    user_id: int,
    batch_size: int = 50,
) -> int:
    """Generate embeddings for all items that don't have one yet. Returns count of items embedded."""
    items = list(
        db.scalars(
            select(MemoryItem).where(
                MemoryItem.user_id == user_id,
                MemoryItem.superseded_by.is_(None),
                MemoryItem.embedding_json.is_(None),
            )
            .limit(batch_size)
        ).all()
    )

    count = 0
    for item in items:
        if await embed_memory_item(db, item):
            count += 1

    if count > 0:
        db.flush()
    return count


def sync_to_vector_store(
    db: Session,
    *,
    user_id: int,
) -> int:
    """Sync all items with existing embeddings into ChromaDB. Used after vault import."""
    items = list(
        db.scalars(
            select(MemoryItem).where(
                MemoryItem.user_id == user_id,
                MemoryItem.superseded_by.is_(None),
                MemoryItem.embedding_json.isnot(None),
            )
        ).all()
    )

    if not items:
        return 0

    try:
        from anima_server.services.agent.vector_store import rebuild_user_index

        index_data = [
            (item.id, item.content, item.embedding_json, item.category, item.importance)
            for item in items
            if isinstance(item.embedding_json, list) and item.embedding_json
        ]
        return rebuild_user_index(user_id, index_data)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to sync embeddings to vector store for user %d", user_id)
        return 0


def _parse_embedding(raw: Any) -> list[float] | None:
    """Parse an embedding from the JSON column value."""
    if raw is None:
        return None
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return parsed
        except (json.JSONDecodeError, TypeError):
            pass
    return None
