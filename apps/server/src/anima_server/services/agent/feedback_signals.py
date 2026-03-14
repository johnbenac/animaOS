"""Feedback signal collection: detect re-asks, corrections, and abandonment.

Analyzes conversation patterns to identify when the agent's response wasn't
satisfactory. These signals feed into procedural rule generation, helping the
agent learn from its mistakes.

Signal types:
- re_ask: user asks the same question again (agent didn't answer well)
- correction: user explicitly corrects the agent's output
- abandonment: user drops a topic without resolution
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from anima_server.models import AgentMessage, AgentThread, SelfModelBlock

logger = logging.getLogger(__name__)

_CORRECTION_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"(?:no|nope),?\s+(?:I (?:said|meant|want)|that'?s (?:not|wrong))", re.IGNORECASE),
    re.compile(r"(?:actually|wait),?\s+(?:I (?:said|meant|want)|that'?s (?:not|wrong))", re.IGNORECASE),
    re.compile(r"that'?s not what I (?:asked|meant|said|wanted)", re.IGNORECASE),
    re.compile(r"you (?:misunderstood|got it wrong|didn'?t understand)", re.IGNORECASE),
    re.compile(r"I (?:already|just) (?:told|said|asked)", re.IGNORECASE),
    re.compile(r"let me (?:rephrase|clarify|re-?explain)", re.IGNORECASE),
)

_REASK_SIMILARITY_THRESHOLD = 0.6


@dataclass(frozen=True, slots=True)
class FeedbackSignal:
    signal_type: str  # re_ask, correction, abandonment
    evidence: str
    topic: str
    severity: float  # 0.0 to 1.0


def detect_correction(user_message: str) -> FeedbackSignal | None:
    """Check if a user message contains a correction of the agent."""
    for pattern in _CORRECTION_PATTERNS:
        match = pattern.search(user_message)
        if match:
            return FeedbackSignal(
                signal_type="correction",
                evidence=user_message[:200],
                topic=match.group(0),
                severity=0.7,
            )
    return None


def detect_reask(
    user_message: str,
    recent_user_messages: list[str],
) -> FeedbackSignal | None:
    """Check if user is re-asking something they already asked."""
    if not recent_user_messages:
        return None

    user_words = set(user_message.lower().split())
    if len(user_words) < 3:
        return None

    for prev in recent_user_messages:
        prev_words = set(prev.lower().split())
        if len(prev_words) < 3:
            continue
        overlap = len(user_words & prev_words)
        total = len(user_words | prev_words)
        if total == 0:
            continue
        similarity = overlap / total
        if similarity >= _REASK_SIMILARITY_THRESHOLD:
            return FeedbackSignal(
                signal_type="re_ask",
                evidence=f"Similar to previous: '{prev[:100]}'",
                topic=user_message[:100],
                severity=0.6,
            )
    return None


def collect_feedback_signals(
    db: Session,
    *,
    user_id: int,
    user_message: str,
    thread_id: int | None = None,
) -> list[FeedbackSignal]:
    """Collect all feedback signals from a user message in context."""
    signals: list[FeedbackSignal] = []

    # Check for correction
    correction = detect_correction(user_message)
    if correction is not None:
        signals.append(correction)

    # Check for re-ask by comparing to recent user messages
    if thread_id is None:
        thread = db.scalar(
            select(AgentThread).where(AgentThread.user_id == user_id)
        )
        if thread is not None:
            thread_id = thread.id

    if thread_id is not None:
        recent = db.scalars(
            select(AgentMessage.content_text)
            .where(
                AgentMessage.thread_id == thread_id,
                AgentMessage.role == "user",
                AgentMessage.is_in_context.is_(True),
            )
            .order_by(AgentMessage.sequence_id.desc())
            .limit(5)
        ).all()

        recent_texts = [t for t in recent if t and t != user_message]
        reask = detect_reask(user_message, recent_texts)
        if reask is not None:
            signals.append(reask)

    return signals


def record_feedback_signals(
    db: Session,
    *,
    user_id: int,
    signals: list[FeedbackSignal],
) -> int:
    """Record feedback signals into the growth log for procedural rule generation."""
    if not signals:
        return 0

    from anima_server.services.agent.self_model import (
        append_growth_log_entry,
        ensure_self_model_exists,
    )

    ensure_self_model_exists(db, user_id=user_id)
    recorded = 0

    for signal in signals:
        entry = f"Feedback signal ({signal.signal_type}): {signal.evidence[:150]}"
        append_growth_log_entry(db, user_id=user_id, entry=entry)
        recorded += 1

    return recorded
