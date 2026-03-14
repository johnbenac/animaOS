"""In-memory vector store for semantic memory search.

Embeddings already persist in SQLite via ``MemoryItem.embedding_json``. This
module keeps a process-local index for faster similarity search without
writing raw memory content back to disk under ``settings.data_dir``.
"""

from __future__ import annotations

import logging
import math
import shutil
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Any

from anima_server.config import settings

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class _VectorRecord:
    item_id: int
    content: str
    embedding: list[float]
    category: str
    importance: int


class _InMemoryCollection:
    def __init__(self) -> None:
        self._records: dict[str, _VectorRecord] = {}

    def count(self) -> int:
        return len(self._records)

    def upsert(
        self,
        *,
        ids: list[str],
        embeddings: list[list[float]],
        documents: list[str],
        metadatas: list[dict[str, Any]],
    ) -> None:
        for idx, doc_id in enumerate(ids):
            metadata = metadatas[idx] if idx < len(metadatas) else {}
            self._records[str(doc_id)] = _VectorRecord(
                item_id=int(metadata.get("item_id", int(doc_id))),
                content=documents[idx],
                embedding=embeddings[idx],
                category=str(metadata.get("category", "fact")),
                importance=int(metadata.get("importance", 3)),
            )

    def delete(self, *, ids: list[str]) -> None:
        for doc_id in ids:
            self._records.pop(str(doc_id), None)

    def query(
        self,
        *,
        query_embeddings: list[list[float]] | None = None,
        query_texts: list[str] | None = None,
        n_results: int = 10,
        where: dict[str, Any] | None = None,
        include: list[str] | None = None,
    ) -> dict[str, list[list[Any]]]:
        del include  # The in-memory store always returns the same response shape.

        filtered = [
            (doc_id, record)
            for doc_id, record in self._records.items()
            if _matches_where(record, where)
        ]

        if not filtered:
            return {"ids": [[]], "documents": [[]], "metadatas": [[]], "distances": [[]]}

        scored: list[tuple[str, _VectorRecord, float]] = []
        if query_embeddings:
            query_embedding = query_embeddings[0]
            for doc_id, record in filtered:
                similarity = _cosine_similarity(query_embedding, record.embedding)
                scored.append((doc_id, record, 1.0 - similarity))
        elif query_texts:
            query_text = query_texts[0]
            for doc_id, record in filtered:
                similarity = _text_similarity(query_text, record.content)
                scored.append((doc_id, record, 1.0 - similarity))
        else:
            scored = [(doc_id, record, 1.0) for doc_id, record in filtered]

        scored.sort(key=lambda item: item[2])
        top = scored[: min(n_results, len(scored))]
        return {
            "ids": [[doc_id for doc_id, _, _ in top]],
            "documents": [[record.content for _, record, _ in top]],
            "metadatas": [[
                {
                    "category": record.category,
                    "importance": record.importance,
                    "item_id": record.item_id,
                }
                for _, record, _ in top
            ]],
            "distances": [[distance for _, _, distance in top]],
        }


class _InMemoryVectorClient:
    def __init__(self) -> None:
        self._collections: dict[str, _InMemoryCollection] = {}

    def get_or_create_collection(
        self,
        *,
        name: str,
        metadata: dict[str, Any] | None = None,
    ) -> _InMemoryCollection:
        del metadata
        collection = self._collections.get(name)
        if collection is None:
            collection = _InMemoryCollection()
            self._collections[name] = collection
        return collection

    def delete_collection(self, name: str) -> None:
        self._collections.pop(name, None)

    def reset(self) -> None:
        self._collections.clear()

    def clear_system_cache(self) -> None:
        self.reset()


_client: _InMemoryVectorClient | None = None
_client_lock = Lock()
_legacy_cleanup_done = False
_legacy_cleanup_lock = Lock()


def _cleanup_legacy_persist_dir() -> None:
    global _legacy_cleanup_done
    if _legacy_cleanup_done:
        return

    with _legacy_cleanup_lock:
        if _legacy_cleanup_done:
            return

        legacy_dir = Path(settings.data_dir) / "chroma"
        if legacy_dir.exists():
            shutil.rmtree(legacy_dir, ignore_errors=True)
            logger.info("Removed legacy plaintext vector store at %s", legacy_dir)
        _legacy_cleanup_done = True


def _get_vector_client() -> _InMemoryVectorClient:
    """Lazy-initialize an in-memory vector client."""
    global _client
    if _client is not None:
        return _client

    with _client_lock:
        if _client is not None:
            return _client

        _cleanup_legacy_persist_dir()
        _client = _InMemoryVectorClient()
        logger.info("Vector store initialized in process memory")
        return _client


def _collection_name(user_id: int) -> str:
    return f"user_{user_id}_memories"


def get_collection(user_id: int) -> _InMemoryCollection:
    """Get or create the per-user collection."""
    client = _get_vector_client()
    return client.get_or_create_collection(
        name=_collection_name(user_id),
        metadata={"space": "cosine"},
    )


def upsert_memory(
    user_id: int,
    *,
    item_id: int,
    content: str,
    embedding: list[float],
    category: str = "fact",
    importance: int = 3,
) -> None:
    """Insert or update a memory item in the vector store."""
    collection = get_collection(user_id)
    collection.upsert(
        ids=[str(item_id)],
        embeddings=[embedding],
        documents=[content],
        metadatas=[{
            "category": category,
            "importance": importance,
            "item_id": item_id,
        }],
    )


def delete_memory(user_id: int, *, item_id: int) -> None:
    """Remove a memory item from the vector store."""
    try:
        collection = get_collection(user_id)
        collection.delete(ids=[str(item_id)])
    except Exception:  # noqa: BLE001
        logger.debug("Failed to delete item %d from vector store", item_id)


def search_similar(
    user_id: int,
    *,
    query_embedding: list[float],
    limit: int = 10,
    category: str | None = None,
) -> list[dict[str, Any]]:
    """Search for similar memories. Returns list of {id, content, category, importance, similarity}."""
    collection = get_collection(user_id)

    if collection.count() == 0:
        return []

    where_filter = {"category": category} if category is not None else None
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=min(limit, collection.count()),
        where=where_filter,
        include=["documents", "metadatas", "distances"],
    )

    items: list[dict[str, Any]] = []
    if not results["ids"] or not results["ids"][0]:
        return items

    for idx, doc_id in enumerate(results["ids"][0]):
        metadata = results["metadatas"][0][idx] if results["metadatas"] else {}
        distance = results["distances"][0][idx] if results["distances"] else 1.0
        document = results["documents"][0][idx] if results["documents"] else ""
        similarity = 1.0 - distance
        items.append(
            {
                "id": int(doc_id),
                "content": document,
                "category": metadata.get("category", "fact"),
                "importance": metadata.get("importance", 3),
                "similarity": round(similarity, 4),
            }
        )

    return items


def search_by_text(
    user_id: int,
    *,
    query_text: str,
    limit: int = 10,
    category: str | None = None,
) -> list[dict[str, Any]]:
    """Search using naive text overlap over the in-memory collection."""
    collection = get_collection(user_id)

    if collection.count() == 0:
        return []

    where_filter = {"category": category} if category is not None else None
    results = collection.query(
        query_texts=[query_text],
        n_results=min(limit, collection.count()),
        where=where_filter,
        include=["documents", "metadatas", "distances"],
    )

    items: list[dict[str, Any]] = []
    if not results["ids"] or not results["ids"][0]:
        return items

    for idx, doc_id in enumerate(results["ids"][0]):
        metadata = results["metadatas"][0][idx] if results["metadatas"] else {}
        distance = results["distances"][0][idx] if results["distances"] else 1.0
        document = results["documents"][0][idx] if results["documents"] else ""
        items.append(
            {
                "id": int(doc_id),
                "content": document,
                "category": metadata.get("category", "fact"),
                "importance": metadata.get("importance", 3),
                "similarity": round(1.0 - distance, 4),
            }
        )

    return items


def rebuild_user_index(
    user_id: int,
    items: list[tuple[int, str, list[float], str, int]],
) -> int:
    """Rebuild the entire in-memory index for a user."""
    client = _get_vector_client()
    client.delete_collection(_collection_name(user_id))

    if not items:
        return 0

    collection = get_collection(user_id)
    ids = [str(item[0]) for item in items]
    documents = [item[1] for item in items]
    embeddings = [item[2] for item in items]
    metadatas = [
        {"category": item[3], "importance": item[4], "item_id": item[0]}
        for item in items
    ]

    batch_size = 500
    for start in range(0, len(ids), batch_size):
        end = start + batch_size
        collection.upsert(
            ids=ids[start:end],
            embeddings=embeddings[start:end],
            documents=documents[start:end],
            metadatas=metadatas[start:end],
        )

    return len(ids)


def reset_vector_store() -> None:
    """Reset the in-memory vector store. Used in tests."""
    global _client, _legacy_cleanup_done
    with _client_lock:
        if _client is not None:
            _client.reset()
            _client = None
    _legacy_cleanup_done = False


def _matches_where(record: _VectorRecord, where: dict[str, Any] | None) -> bool:
    if where is None:
        return True
    category = where.get("category")
    if category is not None and record.category != category:
        return False
    return True


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    if len(a) != len(b) or not a:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


def _text_similarity(query_text: str, content: str) -> float:
    query_terms = set(query_text.lower().split())
    content_terms = set(content.lower().split())
    if not query_terms or not content_terms:
        return 0.0
    intersection = query_terms & content_terms
    union = query_terms | content_terms
    return len(intersection) / len(union)
