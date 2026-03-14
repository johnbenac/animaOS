"""Consciousness layer models: self-model blocks and emotional signals."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from anima_server.db.base import Base


class SelfModelBlock(Base):
    """Per-user self-model section.

    Sections: identity, inner_state, working_memory, growth_log, intentions.
    Each user has at most one row per section. Identity uses profile-pattern
    (full rewrite), growth_log uses append-pattern, others are mutable.
    """

    __tablename__ = "self_model_blocks"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    section: Mapped[str] = mapped_column(
        String(32), nullable=False,
    )  # identity, inner_state, working_memory, growth_log, intentions
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_by: Mapped[str] = mapped_column(
        String(32), nullable=False, default="system",
    )  # system, sleep_time, post_turn, user_edit
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class EmotionalSignal(Base):
    """Detected emotional signal from a conversation turn.

    Stores per-conversation emotion detections with confidence, trajectory,
    and evidence. Used to build the agent's "gut feeling" about the user.
    """

    __tablename__ = "emotional_signals"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    thread_id: Mapped[int | None] = mapped_column(
        ForeignKey("agent_threads.id", ondelete="SET NULL"),
        nullable=True,
    )
    emotion: Mapped[str] = mapped_column(
        String(32), nullable=False,
    )  # frustrated, excited, anxious, calm, stressed, relieved, curious, disappointed
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    evidence_type: Mapped[str] = mapped_column(
        String(24), nullable=False, default="linguistic",
    )  # explicit, linguistic, behavioral, contextual
    evidence: Mapped[str] = mapped_column(Text, nullable=False, default="")
    trajectory: Mapped[str] = mapped_column(
        String(24), nullable=False, default="stable",
    )  # escalating, de-escalating, stable, shifted
    previous_emotion: Mapped[str | None] = mapped_column(String(32), nullable=True)
    topic: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    acted_on: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
