"""Memory consolidation: extract and store memories from conversation turns."""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from threading import Lock
from typing import Any

from anima_server.config import settings
from anima_server.services.agent.memory_store import (
    add_daily_log,
    set_current_focus,
    store_memory_item,
    supersede_memory_item,
)
from anima_server.services.data_crypto import df

logger = logging.getLogger(__name__)

_background_tasks_lock = Lock()
_background_tasks: set[asyncio.Task[None]] = set()


@dataclass(frozen=True, slots=True)
class ExtractedTurnMemory:
    facts: tuple[str, ...] = ()
    preferences: tuple[str, ...] = ()
    current_focus: str | None = None


@dataclass(frozen=True, slots=True)
class PatternExtractor:
    pattern: re.Pattern[str]
    formatter: Callable[[str], str]


@dataclass(slots=True)
class MemoryConsolidationResult:
    daily_log_id: int | None = None
    facts_added: list[str] = field(default_factory=list)
    preferences_added: list[str] = field(default_factory=list)
    current_focus_updated: str | None = None
    llm_items_added: list[str] = field(default_factory=list)
    conflicts_resolved: list[str] = field(default_factory=list)


_FACT_EXTRACTORS: tuple[PatternExtractor, ...] = (
    PatternExtractor(
        pattern=re.compile(r"\bI am (?P<value>\d{1,3}) years old\b", re.IGNORECASE),
        formatter=lambda value: f"Age: {value}",
    ),
    PatternExtractor(
        pattern=re.compile(r"\bmy birthday is (?P<value>[^.?!\n]+)", re.IGNORECASE),
        formatter=lambda value: f"Birthday: {value}",
    ),
    PatternExtractor(
        pattern=re.compile(r"\bI work as (?P<value>[^.?!\n]+)", re.IGNORECASE),
        formatter=lambda value: f"Works as {value}",
    ),
    PatternExtractor(
        pattern=re.compile(r"\bmy (?:sister|brother) is named (?P<value>[^.?!\n]+)", re.IGNORECASE),
        formatter=lambda value: f"Sibling: {value}",
    ),
    PatternExtractor(
        pattern=re.compile(r"\bmy (?:mom|mother) is named (?P<value>[^.?!\n]+)", re.IGNORECASE),
        formatter=lambda value: f"Mother: {value}",
    ),
    PatternExtractor(
        pattern=re.compile(r"\bmy (?:dad|father) is named (?P<value>[^.?!\n]+)", re.IGNORECASE),
        formatter=lambda value: f"Father: {value}",
    ),
    PatternExtractor(
        pattern=re.compile(r"\bmy partner (?:is named)?\s*(?P<value>[^.?!\n]+)", re.IGNORECASE),
        formatter=lambda value: f"Partner: {value}",
    ),
    PatternExtractor(
        pattern=re.compile(r"\bi live in (?P<value>[^.?!\n]+)", re.IGNORECASE),
        formatter=lambda value: f"Location: {value}",
    ),
    PatternExtractor(
        pattern=re.compile(r"\b(?:i'm|i am) allergic to (?P<value>[^.?!\n]+)", re.IGNORECASE),
        formatter=lambda value: f"Allergy: {value}",
    ),
    PatternExtractor(
        pattern=re.compile(r"\b(?:i'm|i am) vegetarian\b", re.IGNORECASE),
        formatter=lambda _: "Diet: Vegetarian",
    ),
    PatternExtractor(
        pattern=re.compile(r"\b(?:i'm|i am) vegan\b", re.IGNORECASE),
        formatter=lambda _: "Diet: Vegan",
    ),
    PatternExtractor(
        pattern=re.compile(r"\bcall me (?P<value>[^.?!\n]+)", re.IGNORECASE),
        formatter=lambda value: f"Preferred name: {value}",
    ),
    PatternExtractor(
        pattern=re.compile(r"\bmy name is (?P<value>[^.?!\n]+)", re.IGNORECASE),
        formatter=lambda value: f"Name: {value}",
    ),
)


async def consolidate_turn_memory(
    *,
    user_id: int,
    user_message: str,
    assistant_response: str,
    db_factory: Callable[..., object] | None = None,
) -> MemoryConsolidationResult:
    """Extract and store memories from a conversation turn.

    Uses both pattern matching (fast, deterministic) and LLM extraction
    (slow, thorough) in parallel. Pattern matches are stored immediately;
    LLM results are stored when ready.
    """
    result = MemoryConsolidationResult()

    if settings.agent_provider == "scaffold":
        return result

    from anima_server.db.session import get_db_session_context
    from anima_server.services.agent.prompt_loader import get_prompt_loader

    factory = db_factory or get_db_session_context

    # ── Phase 1: Extract with patterns ─────────────────────────
    extracted = _extract_with_patterns(user_message)

    # Write pattern-extracted memories immediately
    with factory() as db:
        for fact in extracted.facts:
            store_memory_item(
                db,
                user_id=user_id,
                content=fact,
                category="fact",
                importance=4,
                source_turn_id=None,
            )
            result.facts_added.append(fact)

        for pref in extracted.preferences:
            store_memory_item(
                db,
                user_id=user_id,
                content=pref,
                category="preference",
                importance=3,
                source_turn_id=None,
            )
            result.preferences_added.append(pref)

        if extracted.current_focus:
            set_current_focus(db, user_id=user_id, focus=extracted.current_focus)
            result.current_focus_updated = extracted.current_focus

        # Add to daily log for aggregation
        log = add_daily_log(
            db,
            user_id=user_id,
            raw_text=user_message,
        )
        result.daily_log_id = log.id if log else None

        # Load prompt loader for LLM extraction
        prompt_loader = get_prompt_loader(db, user_id)

        db.commit()

    # ── Phase 2: LLM extraction (non-blocking) ─────────────────
    async def _llm_extraction():
        try:
            prompt = prompt_loader.memory_extraction(
                user_message=user_message,
                assistant_response=assistant_response,
            )

            from anima_server.services.agent.service import call_llm_for_reflection

            response = await call_llm_for_reflection(
                prompt,
                system=f"You are a memory extraction system for {prompt_loader.agent_name}.",
            )
            if not response:
                return

            from anima_server.services.agent.json_utils import parse_json_object

            parsed = parse_json_object(response)
            if not parsed:
                return

            memories = parsed.get("memories", [])
            if not isinstance(memories, list):
                return

            # Check for conflicts with existing memories before storing
            conflict_check_results: list[tuple[dict, str | None]] = []
            for mem in memories:
                if not isinstance(mem, dict):
                    continue
                content = mem.get("content", "").strip()
                if not content:
                    continue

                # Search for potentially conflicting memories
                from anima_server.services.agent.memory_store import search_memories

                with factory() as db_check:
                    existing = search_memories(
                        db_check, user_id=user_id, query=content, limit=5
                    )
                    conflict_id = await _check_conflict_batch(
                        prompt_loader, content, existing
                    )
                    conflict_check_results.append((mem, conflict_id))

            # Store memories, handling conflicts
            with factory() as db:
                for mem, conflict_id in conflict_check_results:
                    content = mem.get("content", "").strip()
                    category = mem.get("category", "fact")
                    importance = mem.get("importance", 3)

                    if conflict_id:
                        # Update existing memory
                        supersede_memory_item(
                            db,
                            user_id=user_id,
                            old_item_id=conflict_id,
                            new_content=content,
                            reason="Updated by consolidation",
                        )
                        result.conflicts_resolved.append(f"Updated: {content[:50]}...")
                    else:
                        # Store new memory
                        store_memory_item(
                            db,
                            user_id=user_id,
                            content=content,
                            category=category,
                            importance=importance,
                            source_turn_id=None,
                        )
                        result.llm_items_added.append(content)

                db.commit()

        except Exception:
            logger.exception("LLM extraction failed for user %s", user_id)

    # Fire-and-forget LLM extraction
    with _background_tasks_lock:
        task = asyncio.create_task(_llm_extraction())
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)

    return result


def _extract_with_patterns(user_message: str) -> ExtractedTurnMemory:
    """Extract memories using deterministic regex patterns."""
    facts: list[str] = []
    preferences: list[str] = []

    for extractor in _FACT_EXTRACTORS:
        match = extractor.pattern.search(user_message)
        if match:
            value = match.group("value").strip() if "value" in match.groupdict() else ""
            formatted = extractor.formatter(value)
            facts.append(formatted)

    # Simple preference detection
    if re.search(r"\bi (?:like|love|enjoy|prefer)\b", user_message, re.IGNORECASE):
        # Extract the preference statement
        match = re.search(
            r"\bi (?:like|love|enjoy|prefer)\s+([^;.?!\n]+)",
            user_message,
            re.IGNORECASE,
        )
        if match:
            preferences.append(f"Preference: {match.group(1).strip()}")

    # Current focus detection
    current_focus = None
    focus_match = re.search(
        r"\b(?:i'm|i am)\s+(?:working on|focused on|trying to)\s+([^;.?!\n]+)",
        user_message,
        re.IGNORECASE,
    )
    if focus_match:
        current_focus = focus_match.group(1).strip()

    return ExtractedTurnMemory(
        facts=tuple(facts),
        preferences=tuple(preferences),
        current_focus=current_focus,
    )


async def _check_conflict_batch(
    prompt_loader,
    new_content: str,
    existing_memories: Sequence[Any],
) -> str | None:
    """Check if new content conflicts with existing memories using LLM.

    Returns the ID of the existing memory to update, or None if no conflict.
    """
    if not existing_memories:
        return None

    # Format existing memories for the prompt
    existing_text = "\n".join(
        f"[{i}] {df(None, m.content, table='memory_items', field='content')}"
        for i, m in enumerate(existing_memories)
    )

    prompt = prompt_loader.batch_conflict_check(
        existing_memories=existing_text,
        new_content=new_content,
    )

    from anima_server.services.agent.service import call_llm_for_reflection

    response = await call_llm_for_reflection(
        prompt,
        system="You are a memory conflict detection system. Respond only with UPDATE <id> or DIFFERENT.",
    )
    if not response:
        return None

    # Parse response
    match = re.search(r"UPDATE\s+(\d+)", response.strip())
    if match:
        idx = int(match.group(1))
        if 0 <= idx < len(existing_memories):
            return existing_memories[idx].id

    return None


async def _check_conflict(
    prompt_loader,
    existing_content: str,
    new_content: str,
) -> bool:
    """Check if new content updates/replaces existing content.

    Returns True if the new content is an update to the existing.
    """
    prompt = prompt_loader.conflict_check(
        existing=existing_content,
        new_content=new_content,
    )

    from anima_server.services.agent.service import call_llm_for_reflection

    response = await call_llm_for_reflection(
        prompt,
        system="You are a memory conflict detection system. Respond only with UPDATE or DIFFERENT.",
    )
    if not response:
        return False

    return response.strip().upper() == "UPDATE"
