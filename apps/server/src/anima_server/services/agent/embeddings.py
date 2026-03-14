"""Vector embedding support for semantic memory search.

Generates embeddings via LLM providers and stores them in both:
- ChromaDB (for fast HNSW-indexed similarity search)
- MemoryItem.embedding_json (for vault export/import portability)
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

logger = logging.getLogger(__name__)


async def generate_embedding(text: str) -> list[float] | None:
    """Generate an embedding vector for the given text using the configured provider."""
    if settings.agent_provider == "scaffold":
        return None

    provider = settings.agent_provider
    try:
        if provider == "openai":
            return await _embed_openai(text)
        if provider == "ollama":
            return await _embed_ollama(text)
        if provider == "anthropic":
            # Anthropic doesn't have an embedding API; fall back to ollama if available
            return await _embed_ollama(text)
        return None
    except Exception:  # noqa: BLE001
        logger.exception("Embedding generation failed for provider %s", provider)
        return None


async def _embed_openai(text: str) -> list[float] | None:
    try:
        import openai
    except ImportError:
        logger.warning("openai package not installed, skipping embedding")
        return None

    api_key = settings.agent_api_key
    if not api_key:
        return None

    client = openai.AsyncOpenAI(api_key=api_key)
    model = settings.agent_extraction_model or "text-embedding-3-small"
    response = await client.embeddings.create(input=[text], model=model)
    return response.data[0].embedding


async def _embed_ollama(text: str) -> list[float] | None:
    import httpx

    base_url = settings.agent_base_url or "http://localhost:11434"
    model = settings.agent_extraction_model or "nomic-embed-text"

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
