from __future__ import annotations

import math
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from anima_server.models import MemoryDailyLog, MemoryItem

# Decay half-life in days — after this many days, recency score halves
_DECAY_HALF_LIFE_DAYS = 14.0
# Weight factors for the retrieval score formula
_WEIGHT_IMPORTANCE = 0.4
_WEIGHT_RECENCY = 0.35
_WEIGHT_ACCESS = 0.25


def add_memory_item(
    db: Session,
    *,
    user_id: int,
    content: str,
    category: str,
    importance: int = 3,
    source: str = "extraction",
) -> MemoryItem | None:
    existing = get_memory_items(db, user_id=user_id, category=category)
    for item in existing:
        if _is_duplicate(item.content, content):
            return None

    memory_item = MemoryItem(
        user_id=user_id,
        content=content,
        category=category,
        importance=importance,
        source=source,
    )
    db.add(memory_item)
    db.flush()
    return memory_item


def get_memory_items(
    db: Session,
    *,
    user_id: int,
    category: str | None = None,
    limit: int = 50,
    active_only: bool = True,
) -> list[MemoryItem]:
    query = select(MemoryItem).where(MemoryItem.user_id == user_id)
    if category is not None:
        query = query.where(MemoryItem.category == category)
    if active_only:
        query = query.where(MemoryItem.superseded_by.is_(None))
    query = query.order_by(MemoryItem.created_at.desc()).limit(limit)
    return list(db.scalars(query).all())


def get_memory_items_scored(
    db: Session,
    *,
    user_id: int,
    category: str | None = None,
    limit: int = 50,
    now: datetime | None = None,
) -> list[MemoryItem]:
    """Retrieve memory items ranked by a multi-factor score: importance, recency, access frequency."""
    query = select(MemoryItem).where(
        MemoryItem.user_id == user_id,
        MemoryItem.superseded_by.is_(None),
    )
    if category is not None:
        query = query.where(MemoryItem.category == category)
    # Fetch a larger pool, then rank in Python
    pool_limit = min(limit * 3, 200)
    query = query.order_by(MemoryItem.created_at.desc()).limit(pool_limit)
    items = list(db.scalars(query).all())

    if not items:
        return []

    ref_now = now or datetime.now(UTC)
    scored = [(_retrieval_score(item, ref_now), item) for item in items]
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [item for _, item in scored[:limit]]


def _retrieval_score(item: MemoryItem, now: datetime) -> float:
    """Compute a 0-1 retrieval score combining importance, recency, and access frequency."""
    # Importance: normalize 1-5 to 0-1
    importance_score = (item.importance - 1) / 4.0

    # Recency: exponential decay from created_at
    created = item.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=UTC)
    age_days = max(0.0, (now - created).total_seconds() / 86400.0)
    recency_score = math.exp(-0.693 * age_days / _DECAY_HALF_LIFE_DAYS)

    # Access frequency: logarithmic scaling of reference_count
    ref_count = item.reference_count or 0
    access_score = min(1.0, math.log1p(ref_count) / math.log1p(10))

    # Boost if recently referenced (within last 3 days)
    if item.last_referenced_at is not None:
        last_ref = item.last_referenced_at
        if last_ref.tzinfo is None:
            last_ref = last_ref.replace(tzinfo=UTC)
        ref_age_days = (now - last_ref).total_seconds() / 86400.0
        if ref_age_days < 3.0:
            access_score = min(1.0, access_score + 0.3)

    return (
        _WEIGHT_IMPORTANCE * importance_score
        + _WEIGHT_RECENCY * recency_score
        + _WEIGHT_ACCESS * access_score
    )


def touch_memory_items(
    db: Session,
    items: list[MemoryItem],
    *,
    now: datetime | None = None,
) -> None:
    """Update last_referenced_at and increment reference_count for loaded memories."""
    if not items:
        return
    ref_now = now or datetime.now(UTC)
    for item in items:
        item.reference_count = (item.reference_count or 0) + 1
        item.last_referenced_at = ref_now
    db.flush()


def supersede_memory_item(
    db: Session,
    *,
    old_item_id: int,
    new_content: str,
    importance: int | None = None,
) -> MemoryItem:
    old_item = db.get(MemoryItem, old_item_id)
    if old_item is None:
        raise ValueError(f"Memory item {old_item_id} not found")

    new_item = MemoryItem(
        user_id=old_item.user_id,
        content=new_content,
        category=old_item.category,
        importance=importance if importance is not None else old_item.importance,
        source=old_item.source,
    )
    db.add(new_item)
    db.flush()

    old_item.superseded_by = new_item.id
    old_item.updated_at = datetime.now(UTC)
    db.add(old_item)
    db.flush()

    # Remove superseded item from vector store (only if already initialized)
    try:
        import anima_server.services.agent.vector_store as vs

        if vs._client is not None:
            vs.delete_memory(old_item.user_id, item_id=old_item_id)
    except Exception:  # noqa: BLE001
        pass

    return new_item


def add_daily_log(
    db: Session,
    *,
    user_id: int,
    user_message: str,
    assistant_response: str,
) -> MemoryDailyLog:
    log = MemoryDailyLog(
        user_id=user_id,
        date=datetime.now(UTC).date().isoformat(),
        user_message=user_message,
        assistant_response=assistant_response,
    )
    db.add(log)
    db.flush()
    return log


def get_current_focus(db: Session, *, user_id: int) -> str | None:
    item = db.scalar(
        select(MemoryItem)
        .where(
            MemoryItem.user_id == user_id,
            MemoryItem.category == "focus",
            MemoryItem.superseded_by.is_(None),
        )
        .order_by(MemoryItem.created_at.desc())
        .limit(1)
    )
    if item is None:
        return None
    return item.content


def set_current_focus(
    db: Session,
    *,
    user_id: int,
    focus: str,
) -> MemoryItem:
    existing = db.scalar(
        select(MemoryItem)
        .where(
            MemoryItem.user_id == user_id,
            MemoryItem.category == "focus",
            MemoryItem.superseded_by.is_(None),
        )
        .order_by(MemoryItem.created_at.desc())
        .limit(1)
    )
    if existing is not None:
        return supersede_memory_item(
            db,
            old_item_id=existing.id,
            new_content=focus,
        )

    item = MemoryItem(
        user_id=user_id,
        content=focus,
        category="focus",
        importance=4,
        source="user",
    )
    db.add(item)
    db.flush()
    return item


def find_similar_items(
    db: Session,
    *,
    user_id: int,
    content: str,
    category: str,
    threshold: float = 0.5,
) -> list[MemoryItem]:
    existing = get_memory_items(db, user_id=user_id, category=category)
    return [
        item for item in existing
        if _similarity(item.content, content) > threshold
        and not _is_duplicate(item.content, content)
    ]


def _is_duplicate(existing_content: str, new_content: str) -> bool:
    return existing_content.strip().lower() == new_content.strip().lower()


def _similarity(a: str, b: str) -> float:
    """Simple word-overlap (Jaccard) similarity. Returns 0.0-1.0."""
    words_a = set(a.lower().split())
    words_b = set(b.lower().split())
    if not words_a or not words_b:
        return 0.0
    intersection = words_a & words_b
    union = words_a | words_b
    return len(intersection) / len(union)
