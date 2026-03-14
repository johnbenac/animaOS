"""Agent tools registry.

Add tools here as plain functions decorated with @tool.
The `get_tools()` list is bound to the loop runtime and exposed to the LLM.
"""

from __future__ import annotations

import inspect
from collections.abc import Sequence
from datetime import datetime, timezone
from typing import Any, Callable, get_type_hints

from anima_server.services.agent.rules import ToolRule, build_default_tool_rules


class _SimpleSchema:
    """Minimal schema object that satisfies _serialize_tool() in openai_compatible_client."""

    def __init__(self, schema: dict[str, object]) -> None:
        self._schema = schema

    def model_json_schema(self) -> dict[str, object]:
        return self._schema


def tool(func: Callable[..., Any]) -> Any:
    """Minimal tool decorator replacing langchain_core.tools.tool."""
    func.name = func.__name__  # type: ignore[attr-defined]
    func.description = (func.__doc__ or "").strip()  # type: ignore[attr-defined]
    func.args_schema = _build_args_schema(func)  # type: ignore[attr-defined]
    return func


def _build_args_schema(func: Callable[..., Any]) -> _SimpleSchema:
    hints = get_type_hints(func)
    params = inspect.signature(func).parameters
    properties: dict[str, object] = {}
    required: list[str] = []
    for name, param in params.items():
        if name == "return":
            continue
        prop: dict[str, str] = {"type": "string"}
        hint = hints.get(name)
        if hint is str:
            prop["type"] = "string"
        elif hint is int:
            prop["type"] = "integer"
        elif hint is float:
            prop["type"] = "number"
        elif hint is bool:
            prop["type"] = "boolean"
        properties[name] = prop
        if param.default is inspect.Parameter.empty:
            required.append(name)
    return _SimpleSchema({
        "type": "object",
        "properties": properties,
        "required": required,
    })


@tool
def current_datetime() -> str:
    """Return the current date and time in ISO-8601 format (UTC)."""
    return datetime.now(timezone.utc).isoformat()


@tool
def send_message(message: str) -> str:
    """Send a final response to the user and end the current turn."""
    return message


@tool
def note_to_self(key: str, value: str, note_type: str = "observation") -> str:
    """Save a working note for this conversation session. Use this to remember context,
    observations about the user's mood, plans for the conversation, or anything you want
    to track within this session. Notes persist across turns but are not permanent memories.
    Types: observation, plan, context, emotion. Examples:
    - key="user_mood", value="seems stressed about work deadline", note_type="emotion"
    - key="conversation_goal", value="help user plan weekend trip", note_type="plan"
    - key="technical_context", value="user is working on a React app with TypeScript", note_type="context"
    """
    from anima_server.services.agent.tool_context import get_tool_context
    from anima_server.services.agent.session_memory import write_session_note

    ctx = get_tool_context()
    write_session_note(
        ctx.db,
        thread_id=ctx.thread_id,
        user_id=ctx.user_id,
        key=key,
        value=value,
        note_type=note_type,
    )
    return f"Noted: {key}"


@tool
def dismiss_note(key: str) -> str:
    """Remove a session note that is no longer relevant."""
    from anima_server.services.agent.tool_context import get_tool_context
    from anima_server.services.agent.session_memory import remove_session_note

    ctx = get_tool_context()
    removed = remove_session_note(ctx.db, thread_id=ctx.thread_id, key=key)
    if removed:
        return f"Dismissed note: {key}"
    return f"No active note found with key: {key}"


@tool
def save_to_memory(key: str, category: str = "fact", importance: str = "3") -> str:
    """Promote a session note to permanent long-term memory. Use this when you learn
    something important about the user that should be remembered across all future sessions.
    Categories: fact, preference, goal, relationship. Importance: 1-5 (5 = identity-defining).
    """
    from anima_server.services.agent.tool_context import get_tool_context
    from anima_server.services.agent.session_memory import promote_session_note

    ctx = get_tool_context()
    imp = 3
    try:
        imp = max(1, min(5, int(importance)))
    except (ValueError, TypeError):
        pass

    if category not in ("fact", "preference", "goal", "relationship"):
        category = "fact"

    item = promote_session_note(
        ctx.db,
        thread_id=ctx.thread_id,
        user_id=ctx.user_id,
        key=key,
        category=category,
        importance=imp,
    )
    if item is not None:
        return f"Saved to long-term memory: {item.content}"
    return f"Could not promote note '{key}' — not found or duplicate"


@tool
def set_intention(title: str, evidence: str = "", priority: str = "background", deadline: str = "") -> str:
    """Track an ongoing goal or intention for this user across sessions. Use when you notice
    a recurring need, upcoming deadline, or something you should proactively follow up on.
    Priority: high (deadline/urgent), ongoing (long-term), background (passive awareness).
    Examples:
    - title="Help prepare Q2 review", priority="high", deadline="2026-03-20"
    - title="Track career transition progress", priority="ongoing"
    """
    from anima_server.services.agent.tool_context import get_tool_context
    from anima_server.services.agent.intentions import add_intention

    ctx = get_tool_context()
    if priority not in ("high", "ongoing", "background"):
        priority = "background"
    add_intention(
        ctx.db,
        user_id=ctx.user_id,
        title=title,
        evidence=evidence,
        priority=priority,
        deadline=deadline or None,
    )
    return f"Tracking intention: {title}"


@tool
def complete_goal(title: str) -> str:
    """Mark a tracked intention/goal as completed when the user has achieved it or it's no longer needed."""
    from anima_server.services.agent.tool_context import get_tool_context
    from anima_server.services.agent.intentions import complete_intention

    ctx = get_tool_context()
    found = complete_intention(ctx.db, user_id=ctx.user_id, title=title)
    if found:
        return f"Marked as completed: {title}"
    return f"Could not find intention: {title}"


def get_tools() -> list[Any]:
    """Return all tools available to the agent."""
    return [
        current_datetime, send_message,
        note_to_self, dismiss_note, save_to_memory,
        set_intention, complete_goal,
    ]


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


def get_tool_rules(tools: Sequence[Any] | None = None) -> tuple[ToolRule, ...]:
    """Return the default orchestration rules for the registered tools."""
    resolved_tools = tools or get_tools()
    tool_names = {
        getattr(agent_tool, "name", "") or getattr(agent_tool, "__name__", "")
        for agent_tool in resolved_tools
    }
    return build_default_tool_rules(tool_names)
