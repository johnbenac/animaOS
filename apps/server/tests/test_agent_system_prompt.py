from __future__ import annotations

from datetime import UTC, datetime

import pytest
from jinja2 import UndefinedError

from anima_server.services.agent.messages import build_conversation_messages
from anima_server.services.agent.state import StoredMessage
from anima_server.services.agent.system_prompt import (
    SystemPromptContext,
    build_system_prompt,
    render_system_prompt_template,
)


def test_build_system_prompt_includes_structured_sections() -> None:
    prompt = build_system_prompt(
        SystemPromptContext(
            tool_summaries=["current_datetime: Return the current date and time in UTC."],
            user_context="The user prefers concise answers.",
            additional_instructions=["Do not use markdown tables."],
            now=datetime(2026, 3, 14, 9, 30, tzinfo=UTC),
        )
    )

    assert "Identity:" in prompt
    assert "Behavior:" in prompt
    assert "Tool Use:" in prompt
    assert "Runtime:" in prompt
    assert "Available Tools:" in prompt
    assert "User Context:" in prompt
    assert "Additional Instructions:" in prompt
    assert "2026-03-14T09:30:00+00:00" in prompt


def test_build_system_prompt_omits_empty_optional_sections() -> None:
    prompt = build_system_prompt(
        SystemPromptContext(now=datetime(2026, 3, 14, 9, 30, tzinfo=UTC))
    )

    assert "Available Tools:" not in prompt
    assert "User Context:" not in prompt
    assert "Additional Instructions:" not in prompt


def test_render_system_prompt_template_uses_strict_undefined() -> None:
    with pytest.raises(UndefinedError):
        render_system_prompt_template({})


def test_build_conversation_messages_uses_supplied_system_prompt() -> None:
    messages = build_conversation_messages(
        history=[StoredMessage(role="assistant", content="Earlier reply.")],
        user_message="What time is it?",
        system_prompt="System prompt goes here.",
    )

    assert len(messages) == 3
    assert messages[0].content == "System prompt goes here."
    assert messages[1].content == "Earlier reply."
    assert messages[2].content == "What time is it?"
