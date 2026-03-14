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


def get_tools() -> list[Any]:
    """Return all tools available to the agent."""
    return [current_datetime, send_message]


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
