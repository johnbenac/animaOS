"""Self-model management: the agent's understanding of itself per user.

Manages five sections stored in self_model_blocks:
- identity: who the agent is in this relationship (profile-pattern, full rewrite)
- inner_state: current cognitive/emotional processing state (mutable)
- working_memory: cross-session buffer with expiring items (mutable)
- growth_log: append-only changelog of how the agent has evolved
- intentions: active goals and learned behavioral rules (mutable)
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from anima_server.config import settings
from anima_server.models import SelfModelBlock

logger = logging.getLogger(__name__)

SECTIONS = ("identity", "inner_state", "working_memory", "growth_log", "intentions")

_SEED_IDENTITY = """# Who I Am
<!-- certainty: low -->
I'm still getting to know this person. My understanding will deepen over time.

# My Relationship With This User
<!-- certainty: low -->
This is a new relationship. I don't have enough context yet to characterize it.

# How I Communicate With Them
<!-- certainty: low -->
Using my default communication style until I learn their preferences.

# What I'm Uncertain About
<!-- certainty: low -->
Everything — we're just getting started."""

_SEED_INNER_STATE = """# Current Sense of the User
No strong signals yet — too early to form impressions.

# Active Threads
No ongoing threads yet.

# Things I'm Curious About
- What matters most to this person
- How they prefer to communicate
- What they need from me

# Recent Observations
None yet."""

_SEED_WORKING_MEMORY = """# Things I'm Holding in Mind
No items yet."""

_SEED_GROWTH_LOG = ""

_SEED_INTENTIONS = """# Active Intentions

## Ongoing
- **Learn this person's communication preferences**
  - Evidence: New relationship — no data yet
  - Status: Active — observing
  - Strategy: Pay attention to how they respond to different styles

# Behavioral Rules I've Learned
No rules yet — still observing."""

_SEEDS: dict[str, str] = {
    "identity": _SEED_IDENTITY,
    "inner_state": _SEED_INNER_STATE,
    "working_memory": _SEED_WORKING_MEMORY,
    "growth_log": _SEED_GROWTH_LOG,
    "intentions": _SEED_INTENTIONS,
}

_BUDGET: dict[str, int] = {
    "identity": settings.agent_self_model_identity_budget,
    "inner_state": settings.agent_self_model_inner_state_budget,
    "working_memory": settings.agent_self_model_working_memory_budget,
    "growth_log": settings.agent_self_model_growth_log_budget,
    "intentions": settings.agent_self_model_intentions_budget,
}


def get_self_model_block(
    db: Session,
    *,
    user_id: int,
    section: str,
) -> SelfModelBlock | None:
    """Get a single self-model section."""
    if section not in SECTIONS:
        return None
    return db.scalar(
        select(SelfModelBlock).where(
            SelfModelBlock.user_id == user_id,
            SelfModelBlock.section == section,
        )
    )


def get_all_self_model_blocks(
    db: Session,
    *,
    user_id: int,
) -> dict[str, SelfModelBlock]:
    """Get all self-model sections for a user, keyed by section name."""
    blocks = db.scalars(
        select(SelfModelBlock).where(SelfModelBlock.user_id == user_id)
    ).all()
    return {b.section: b for b in blocks}


def set_self_model_block(
    db: Session,
    *,
    user_id: int,
    section: str,
    content: str,
    updated_by: str = "system",
    metadata: dict | None = None,
) -> SelfModelBlock:
    """Create or update a self-model section. Bumps version on update."""
    if section not in SECTIONS:
        raise ValueError(f"Invalid section: {section}")

    existing = get_self_model_block(db, user_id=user_id, section=section)
    if existing is not None:
        existing.content = content
        existing.version += 1
        existing.updated_by = updated_by
        existing.updated_at = datetime.now(UTC)
        if metadata is not None:
            existing.metadata_json = metadata
        db.flush()
        return existing

    block = SelfModelBlock(
        user_id=user_id,
        section=section,
        content=content,
        version=1,
        updated_by=updated_by,
        metadata_json=metadata,
    )
    db.add(block)
    db.flush()
    return block


def append_growth_log_entry(
    db: Session,
    *,
    user_id: int,
    entry: str,
    max_entries: int = 20,
) -> SelfModelBlock:
    """Append an entry to the growth log. Trims to max_entries."""
    block = get_self_model_block(db, user_id=user_id, section="growth_log")
    now = datetime.now(UTC)
    date_str = now.strftime("%Y-%m-%d")
    formatted = f"\n\n### {date_str} — {entry}" if entry else ""

    if block is None:
        block = SelfModelBlock(
            user_id=user_id,
            section="growth_log",
            content=formatted.strip(),
            version=1,
            updated_by="sleep_time",
        )
        db.add(block)
        db.flush()
        return block

    # Append and trim
    content = block.content + formatted
    entries = [e.strip() for e in content.split("### ") if e.strip()]
    if len(entries) > max_entries:
        entries = entries[-max_entries:]
    block.content = "\n\n".join(f"### {e}" for e in entries) if entries else ""
    block.version += 1
    block.updated_by = "sleep_time"
    block.updated_at = now
    db.flush()
    return block


def seed_self_model(
    db: Session,
    *,
    user_id: int,
) -> dict[str, SelfModelBlock]:
    """Create initial self-model for a new user. No-op if already exists."""
    existing = get_all_self_model_blocks(db, user_id=user_id)
    created: dict[str, SelfModelBlock] = {}

    for section in SECTIONS:
        if section in existing:
            created[section] = existing[section]
            continue
        block = SelfModelBlock(
            user_id=user_id,
            section=section,
            content=_SEEDS.get(section, ""),
            version=1,
            updated_by="system",
        )
        db.add(block)
        created[section] = block

    db.flush()
    return created


def ensure_self_model_exists(
    db: Session,
    *,
    user_id: int,
) -> None:
    """Ensure self-model exists for user, seeding if necessary."""
    count = db.scalar(
        select(SelfModelBlock.id).where(SelfModelBlock.user_id == user_id).limit(1)
    )
    if count is None:
        seed_self_model(db, user_id=user_id)


def expire_working_memory_items(
    db: Session,
    *,
    user_id: int,
) -> int:
    """Remove expired items from working_memory. Returns count of items removed."""
    import re

    block = get_self_model_block(db, user_id=user_id, section="working_memory")
    if block is None or not block.content.strip():
        return 0

    today = datetime.now(UTC).date()
    lines = block.content.split("\n")
    kept: list[str] = []
    removed = 0

    for line in lines:
        match = re.search(r"\[expires:\s*(\d{4}-\d{2}-\d{2})\]", line)
        if match:
            try:
                expiry = datetime.strptime(match.group(1), "%Y-%m-%d").date()
            except ValueError:
                kept.append(line)
                continue
            if expiry < today:
                removed += 1
                continue
        kept.append(line)

    if removed > 0:
        set_self_model_block(
            db,
            user_id=user_id,
            section="working_memory",
            content="\n".join(kept).strip(),
            updated_by="expiry_sweep",
        )

    return removed


def render_self_model_section(
    block: SelfModelBlock | None,
    *,
    budget: int | None = None,
) -> str:
    """Render a self-model section, respecting character budget."""
    if block is None or not block.content.strip():
        return ""
    content = block.content.strip()
    max_chars = budget or _BUDGET.get(block.section, 1000)
    if len(content) > max_chars:
        content = content[:max_chars]
    return content
