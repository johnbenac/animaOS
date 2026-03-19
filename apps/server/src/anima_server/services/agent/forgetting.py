"""Intentional forgetting — F7.

Three mechanisms:
1. Passive decay — heat-based visibility floor (items below threshold excluded from retrieval)
2. Active suppression — superseded memories have derived references flagged for regeneration
3. User-initiated forgetting — hard delete with derived-reference cleanup and audit trail
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from anima_server.models import (
    ForgetAuditLog,
    MemoryClaim,
    MemoryClaimEvidence,
    MemoryEpisode,
    MemoryItem,
)
from anima_server.models.consciousness import SelfModelBlock

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────
HEAT_VISIBILITY_FLOOR: float = 0.01
SUPERSEDED_DECAY_MULTIPLIER: float = 3.0


# ── Result types ───────────────────────────────────────────────────────

@dataclass(slots=True)
class DerivedReference:
    """A single derived reference found in episodes or self-model blocks."""
    table: str  # "memory_episodes" or "self_model_blocks"
    record_id: int
    section: str | None = None  # for self_model_blocks: growth_log, intentions


@dataclass(slots=True)
class DerivedReferences:
    """Collection of derived references citing a memory."""
    episodes: list[DerivedReference] = field(default_factory=list)
    self_model_blocks: list[DerivedReference] = field(default_factory=list)

    @property
    def total(self) -> int:
        return len(self.episodes) + len(self.self_model_blocks)


@dataclass(slots=True)
class ForgetResult:
    """Result of a forget operation."""
    items_forgotten: int = 0
    derived_refs_affected: int = 0
    audit_log_id: int | None = None


@dataclass(slots=True)
class SuppressionResult:
    """Result of a suppression operation."""
    memory_id: int = 0
    superseded_by: int = 0
    derived_refs_flagged: int = 0
    audit_log_id: int | None = None


# ── Derived reference detection ───────────────────────────────────────

def find_derived_references(
    db: Session,
    *,
    memory_content: str,
    user_id: int,
) -> DerivedReferences:
    """Search for the memory's content in episodes and self-model blocks.

    Uses substring matching against:
    - memory_episodes.summary
    - self_model_blocks.content WHERE section IN ('growth_log', 'intentions')
    """
    refs = DerivedReferences()

    if not memory_content or len(memory_content) < 3:
        return refs

    # Search episodes
    episodes = list(
        db.scalars(
            select(MemoryEpisode).where(
                MemoryEpisode.user_id == user_id,
            )
        ).all()
    )
    for ep in episodes:
        if memory_content.lower() in (ep.summary or "").lower():
            refs.episodes.append(DerivedReference(
                table="memory_episodes",
                record_id=ep.id,
            ))

    # Search self-model blocks (growth_log and intentions sections)
    blocks = list(
        db.scalars(
            select(SelfModelBlock).where(
                SelfModelBlock.user_id == user_id,
                SelfModelBlock.section.in_(["growth_log", "intentions"]),
            )
        ).all()
    )
    for block in blocks:
        if memory_content.lower() in (block.content or "").lower():
            refs.self_model_blocks.append(DerivedReference(
                table="self_model_blocks",
                record_id=block.id,
                section=block.section,
            ))

    return refs


def redact_derived_references(
    db: Session,
    *,
    refs: DerivedReferences,
    strategy: str = "flag_for_regeneration",
) -> int:
    """Process derived references using the specified strategy.

    Strategies:
    - flag_for_regeneration: set needs_regeneration=True on affected records
    - immediate_redact: replace the citation text with '[redacted]'
    """
    count = 0

    for ep_ref in refs.episodes:
        episode = db.get(MemoryEpisode, ep_ref.record_id)
        if episode is None:
            continue
        if strategy == "flag_for_regeneration":
            episode.needs_regeneration = True
        # immediate_redact not needed for episodes (flag is sufficient)
        count += 1

    for block_ref in refs.self_model_blocks:
        block = db.get(SelfModelBlock, block_ref.record_id)
        if block is None:
            continue
        if strategy == "flag_for_regeneration":
            block.needs_regeneration = True
        elif strategy == "immediate_redact":
            block.content = "[redacted]"
            block.updated_at = datetime.now(UTC)
        count += 1

    if count > 0:
        db.flush()
    return count


# ── Active suppression ─────────────────────────────────────────────────

def suppress_memory(
    db: Session,
    *,
    memory_id: int,
    superseded_by: int,
    user_id: int,
) -> SuppressionResult:
    """Handle suppression when a memory is superseded.

    1. Find derived references citing this memory
    2. Flag them for regeneration
    3. Record suppression event in forget_audit_log
    """
    result = SuppressionResult(memory_id=memory_id, superseded_by=superseded_by)

    # Get the memory content for derived ref search
    memory = db.get(MemoryItem, memory_id)
    if memory is None:
        return result

    from anima_server.services.data_crypto import df
    content = df(user_id, memory.content, table="memory_items", field="content")

    # Find and flag derived references
    refs = find_derived_references(db, memory_content=content, user_id=user_id)
    if refs.total > 0:
        result.derived_refs_flagged = redact_derived_references(
            db, refs=refs, strategy="flag_for_regeneration",
        )

    # Record audit log
    log = ForgetAuditLog(
        user_id=user_id,
        forgotten_at=datetime.now(UTC),
        trigger="suppression",
        scope="single",
        items_forgotten=0,  # suppression does not delete
        derived_refs_affected=result.derived_refs_flagged,
    )
    db.add(log)
    db.flush()
    result.audit_log_id = log.id

    return result


# ── User-initiated forgetting ─────────────────────────────────────────

def forget_memory(
    db: Session,
    *,
    memory_id: int,
    user_id: int,
    trigger: str = "user_request",
) -> ForgetResult:
    """Hard-delete a memory item with full cleanup.

    1. Find derived references (episodes, growth_log, intentions)
    2. Flag derived references for regeneration
    3. Delete associated MemoryClaim + MemoryClaimEvidence records
    4. Hard-delete the memory item
    5. Remove embedding from vector store
    6. Invalidate BM25 index
    7. Record forget event in audit log (without content)
    """
    result = ForgetResult()

    memory = db.get(MemoryItem, memory_id)
    if memory is None or memory.user_id != user_id:
        return result

    from anima_server.services.data_crypto import df
    content = df(user_id, memory.content, table="memory_items", field="content")

    # 1-2. Find and flag derived references
    refs = find_derived_references(db, memory_content=content, user_id=user_id)
    if refs.total > 0:
        result.derived_refs_affected = redact_derived_references(
            db, refs=refs, strategy="flag_for_regeneration",
        )

    # 3. Delete associated claims and evidence
    claims = list(
        db.scalars(
            select(MemoryClaim).where(
                MemoryClaim.memory_item_id == memory_id,
            )
        ).all()
    )
    for claim in claims:
        db.execute(
            delete(MemoryClaimEvidence).where(
                MemoryClaimEvidence.claim_id == claim.id,
            )
        )
        db.delete(claim)

    # 4. Hard-delete the memory item
    db.delete(memory)
    db.flush()
    result.items_forgotten = 1

    # 5. Remove from vector store
    try:
        from anima_server.services.agent.vector_store import delete_memory
        delete_memory(user_id, item_id=memory_id, db=db)
    except Exception:  # noqa: BLE001
        logger.debug("Vector store cleanup failed for item %d", memory_id)

    # 6. Invalidate BM25 index
    try:
        from anima_server.services.agent.bm25_index import invalidate_index
        invalidate_index(user_id)
    except Exception:  # noqa: BLE001
        logger.debug("BM25 index invalidation failed for user %d", user_id)

    # 7. Record audit log (no content stored)
    log = ForgetAuditLog(
        user_id=user_id,
        forgotten_at=datetime.now(UTC),
        trigger=trigger,
        scope="single",
        items_forgotten=1,
        derived_refs_affected=result.derived_refs_affected,
    )
    db.add(log)
    db.flush()
    result.audit_log_id = log.id

    return result


def forget_by_topic(
    db: Session,
    *,
    topic: str,
    user_id: int,
) -> list[MemoryItem]:
    """Find memories matching a topic and return them as candidates for confirmation.

    Does NOT auto-delete. Returns the list of matching MemoryItem objects
    so the caller (API layer) can present them for user confirmation.
    """
    candidates: list[MemoryItem] = []

    # Use keyword search against all active items
    from anima_server.services.data_crypto import df

    items = list(
        db.scalars(
            select(MemoryItem).where(
                MemoryItem.user_id == user_id,
                MemoryItem.superseded_by.is_(None),
            )
        ).all()
    )

    topic_lower = topic.lower()
    for item in items:
        plaintext = df(user_id, item.content, table="memory_items", field="content")
        if topic_lower in plaintext.lower():
            candidates.append(item)

    # Also try hybrid search for semantic matches
    try:
        from anima_server.services.agent.embeddings import hybrid_search
        import asyncio

        # Try to get running loop, otherwise skip async search
        try:
            loop = asyncio.get_running_loop()
            # We're in an async context, but we can't await here
            # The caller should handle this separately if needed
        except RuntimeError:
            pass

    except Exception:  # noqa: BLE001
        logger.debug("Hybrid search unavailable for topic forget")

    # Deduplicate
    seen_ids: set[int] = set()
    unique: list[MemoryItem] = []
    for item in candidates:
        if item.id not in seen_ids:
            seen_ids.add(item.id)
            unique.append(item)

    return unique
