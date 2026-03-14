"""Per-user turn serialization.

Ensures that concurrent requests for the same user are serialized so that
sequence allocation, thread state, and turn persistence remain consistent.
"""

from __future__ import annotations

import asyncio
from threading import Lock


_global_lock = Lock()
_user_locks: dict[int, asyncio.Lock] = {}


def get_user_lock(user_id: int) -> asyncio.Lock:
    """Return a per-user asyncio.Lock, creating one if needed."""
    with _global_lock:
        lock = _user_locks.get(user_id)
        if lock is None:
            lock = asyncio.Lock()
            _user_locks[user_id] = lock
        return lock
