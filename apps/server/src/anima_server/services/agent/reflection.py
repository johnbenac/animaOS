from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from datetime import UTC, datetime
from threading import Lock
from typing import Any

from anima_server.config import settings
from anima_server.services.agent.episodes import maybe_generate_episode

logger = logging.getLogger(__name__)

REFLECTION_DELAY_SECONDS = 300  # 5 minutes of inactivity

_reflection_lock = Lock()
_pending_reflection: asyncio.Task[None] | None = None
_last_activity: datetime | None = None


def schedule_reflection(
    *,
    user_id: int,
    thread_id: int | None = None,
) -> None:
    """Schedule a reflection task after a period of inactivity.

    Each new call resets the timer. Only one pending reflection exists at a time.
    """
    if not settings.agent_background_memory_enabled:
        return

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return

    global _pending_reflection, _last_activity

    with _reflection_lock:
        _last_activity = datetime.now(UTC)

        if _pending_reflection is not None and not _pending_reflection.done():
            _pending_reflection.cancel()

        _pending_reflection = loop.create_task(
            _delayed_reflection(
                user_id=user_id,
                thread_id=thread_id,
                scheduled_at=_last_activity,
            )
        )


async def _delayed_reflection(
    *,
    user_id: int,
    thread_id: int | None,
    scheduled_at: datetime,
) -> None:
    """Wait for the inactivity period, then run reflection if no new activity occurred."""
    try:
        await asyncio.sleep(REFLECTION_DELAY_SECONDS)
    except asyncio.CancelledError:
        return

    with _reflection_lock:
        if _last_activity is not None and _last_activity > scheduled_at:
            return

    await run_reflection(user_id=user_id, thread_id=thread_id)


async def run_reflection(
    *,
    user_id: int,
    thread_id: int | None = None,
    db_factory: Callable[..., object] | None = None,
) -> None:
    """Run reflection tasks: episode generation (and future consolidation passes)."""
    try:
        await maybe_generate_episode(
            user_id=user_id,
            thread_id=thread_id,
            db_factory=db_factory,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Reflection failed for user %s", user_id)


async def cancel_pending_reflection() -> None:
    """Cancel any pending reflection task. Useful for shutdown."""
    global _pending_reflection
    with _reflection_lock:
        if _pending_reflection is not None and not _pending_reflection.done():
            _pending_reflection.cancel()
            try:
                await _pending_reflection
            except asyncio.CancelledError:
                pass
            _pending_reflection = None
