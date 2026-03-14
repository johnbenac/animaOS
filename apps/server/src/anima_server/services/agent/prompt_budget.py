"""Prompt budget planner.

Assigns tiered budgets to memory blocks so the total prompt stays within
the model's context window. Blocks are organized into priority tiers:

  Tier 0 (never drop): system rules, persona, soul
  Tier 1 (strongly prefer): self-model identity, current focus, thread summary
  Tier 2 (query-relevant): semantic hits, emotional context, facts, preferences
  Tier 3 (nice-to-have): episodes, goals, relationships, tasks, session memory, growth log

Each tier has a hard character budget. When the total exceeds the overall
budget, lower-tier blocks are truncated or dropped first.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from anima_server.services.agent.memory_blocks import MemoryBlock


# Labels that belong to each tier
_TIER_0_LABELS = frozenset({"soul"})
_TIER_1_LABELS = frozenset({
    "self_identity", "self_inner_state", "self_working_memory",
    "current_focus", "thread_summary", "human",
})
_TIER_2_LABELS = frozenset({
    "relevant_memories", "emotional_context", "facts", "preferences",
    "self_intentions",
})
# Tier 3: everything else


@dataclass(frozen=True, slots=True)
class BudgetConfig:
    """Character budgets per tier. total_budget is the hard ceiling."""
    total_budget: int = 24000
    tier_0_budget: int = 4000
    tier_1_budget: int = 6000
    tier_2_budget: int = 6000
    tier_3_budget: int = 8000


DEFAULT_BUDGET = BudgetConfig()


def _tier_for_label(label: str) -> int:
    if label in _TIER_0_LABELS:
        return 0
    if label in _TIER_1_LABELS:
        return 1
    if label in _TIER_2_LABELS:
        return 2
    return 3


def apply_prompt_budget(
    blocks: Sequence[MemoryBlock],
    budget: BudgetConfig = DEFAULT_BUDGET,
) -> tuple[MemoryBlock, ...]:
    """Apply tiered budgets to a sequence of memory blocks.

    Returns a new sequence with blocks truncated or dropped as needed
    to stay within budget. Preserves insertion order within each tier.
    """
    tier_budgets = {
        0: budget.tier_0_budget,
        1: budget.tier_1_budget,
        2: budget.tier_2_budget,
        3: budget.tier_3_budget,
    }

    # Classify blocks into tiers, preserving order
    tiered: dict[int, list[MemoryBlock]] = {0: [], 1: [], 2: [], 3: []}
    for block in blocks:
        tier = _tier_for_label(block.label)
        tiered[tier].append(block)

    # Apply per-tier budgets
    result: list[MemoryBlock] = []
    total_chars = 0

    for tier in (0, 1, 2, 3):
        tier_remaining = tier_budgets[tier]
        for block in tiered[tier]:
            block_size = len(block.value)

            if block_size == 0:
                continue

            # Check total budget
            if total_chars >= budget.total_budget:
                break

            available = min(tier_remaining, budget.total_budget - total_chars)
            if available <= 0:
                break

            if block_size <= available:
                result.append(block)
                tier_remaining -= block_size
                total_chars += block_size
            else:
                # Truncate to fit
                truncated_value = block.value[:available]
                result.append(MemoryBlock(
                    label=block.label,
                    description=block.description,
                    value=truncated_value,
                    read_only=block.read_only,
                ))
                tier_remaining -= available
                total_chars += available

    return tuple(result)
