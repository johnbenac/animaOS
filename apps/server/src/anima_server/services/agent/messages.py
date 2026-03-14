from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

from anima_server.services.agent.runtime_types import ToolCall
from anima_server.services.agent.state import StoredMessage


def build_conversation_messages(
    history: list[StoredMessage],
    user_message: str,
    *,
    system_prompt: str,
) -> list[Any]:
    messages: list[Any] = [make_system_message(system_prompt)]
    messages.extend(to_runtime_message(message) for message in history)
    messages.append(make_user_message(user_message))
    return messages


def to_runtime_message(message: StoredMessage) -> Any:
    if message.role == "assistant":
        return make_assistant_message(
            message.content,
            tool_calls=message.tool_calls,
        )
    if message.role == "tool":
        return make_tool_message(
            message.content,
            tool_call_id=message.tool_call_id or message.tool_name or "tool",
            name=message.tool_name,
        )
    return make_user_message(message.content)


def make_system_message(content: str) -> Any:
    return SystemMessage(content=content)


def make_user_message(content: str) -> Any:
    return HumanMessage(content=content)


def make_assistant_message(
    content: str,
    *,
    tool_calls: Sequence[ToolCall] = (),
) -> Any:
    return AIMessage(
        content=content,
        tool_calls=[to_tool_call_payload(tool_call) for tool_call in tool_calls],
    )


def make_tool_message(
    content: str,
    *,
    tool_call_id: str,
    name: str | None = None,
) -> Any:
    return ToolMessage(
        content=content,
        tool_call_id=tool_call_id,
        name=name,
    )


def is_assistant_message(message: Any) -> bool:
    return isinstance(message, AIMessage)


def is_user_message(message: Any) -> bool:
    return isinstance(message, HumanMessage)


def extract_last_assistant_content(messages: list[Any]) -> str:
    for message in reversed(messages):
        if is_assistant_message(message) and message_content(message):
            return message_content(message)
    return ""


def extract_tools_used(messages: list[Any]) -> list[str]:
    names: list[str] = []
    for message in messages:
        if not hasattr(message, "tool_calls"):
            continue
        for tool_call in message.tool_calls:
            name = (
                tool_call.get("name", "")
                if isinstance(tool_call, dict)
                else getattr(tool_call, "name", "")
            )
            if name and name not in names:
                names.append(name)
    return names


def message_content(message: Any) -> str:
    content = getattr(message, "content", "")
    return content if isinstance(content, str) else str(content)


def render_scaffold_response(
    user_id: int,
    user_message: str,
    turn_number: int,
) -> str:
    normalized_message = user_message.strip() or "[empty]"
    return (
        f"Python agent scaffold is active for user {user_id}. "
        f"This is turn {turn_number}. Replace the scaffold runtime with a real model call. "
        f"Last message: {normalized_message}"
    )


def to_tool_call_payload(tool_call: ToolCall) -> dict[str, object]:
    return {
        "id": tool_call.id,
        "name": tool_call.name,
        "args": dict(tool_call.arguments),
        "type": "tool_call",
    }
