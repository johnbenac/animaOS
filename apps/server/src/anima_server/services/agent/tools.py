"""Agent tools registry.

Add tools here as plain functions decorated with @tool.
The `get_tools()` list is bound to the LLM in the agent graph.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone
from typing import Any

from langchain_core.tools import tool


@tool
def current_datetime() -> str:
    """Return the current date and time in ISO-8601 format (UTC)."""
    return datetime.now(timezone.utc).isoformat()


def get_tools() -> list[Any]:
    """Return all tools available to the agent."""
    return [current_datetime]


def get_tool_summaries(tools: Sequence[Any] | None = None) -> list[str]:
    """Render tool names and descriptions for prompt construction."""
    resolved_tools = tools or get_tools()
    summaries: list[str] = []

    for agent_tool in resolved_tools:
        name = getattr(agent_tool, "name", "") or getattr(agent_tool, "__name__", "tool")
        description = getattr(agent_tool, "description", "") or ""
        normalized_description = " ".join(description.strip().split())
        if normalized_description:
            summaries.append(f"{name}: {normalized_description}")
        else:
            summaries.append(name)

    return summaries
