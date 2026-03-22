"""Unit tests for Phase 2 dry-run feature — prompt assembly without LLM call."""

from __future__ import annotations

import pytest
from anima_server.services.agent.adapters.base import BaseLLMAdapter
from anima_server.services.agent.memory_blocks import MemoryBlock
from anima_server.services.agent.rules import TerminalToolRule
from anima_server.services.agent.runtime import AgentRuntime
from anima_server.services.agent.runtime_types import (
    DryRunResult,
    LLMRequest,
    StepExecutionResult,
)
from anima_server.services.agent.tools import send_message


class NeverCalledAdapter(BaseLLMAdapter):
    """Adapter that fails if the LLM is actually called — dry-run should skip it."""

    provider = "test"
    model = "test-model"

    async def invoke(self, request: LLMRequest) -> StepExecutionResult:
        raise AssertionError("LLM should not be called during dry run")


def _build_runtime() -> AgentRuntime:
    return AgentRuntime(
        adapter=NeverCalledAdapter(),
        tools=[send_message],
        tool_rules=[TerminalToolRule(tool_name="send_message")],
        max_steps=4,
    )


@pytest.mark.asyncio
async def test_dry_run_returns_dry_run_result() -> None:
    runtime = _build_runtime()
    result = await runtime.invoke(
        "hello",
        user_id=1,
        history=[],
        dry_run=True,
    )
    assert isinstance(result, DryRunResult)


@pytest.mark.asyncio
async def test_dry_run_has_system_prompt() -> None:
    runtime = _build_runtime()
    result = await runtime.invoke(
        "hello",
        user_id=1,
        history=[],
        dry_run=True,
    )
    assert isinstance(result, DryRunResult)
    assert len(result.system_prompt) > 0


@pytest.mark.asyncio
async def test_dry_run_has_messages() -> None:
    runtime = _build_runtime()
    result = await runtime.invoke(
        "hello user",
        user_id=1,
        history=[],
        dry_run=True,
    )
    assert isinstance(result, DryRunResult)
    assert len(result.messages) >= 2  # system + user at minimum
    # The last message should be the user message
    user_msgs = [m for m in result.messages if m.role == "user"]
    assert len(user_msgs) >= 1
    assert "hello user" in user_msgs[-1].content


@pytest.mark.asyncio
async def test_dry_run_has_allowed_tools() -> None:
    runtime = _build_runtime()
    result = await runtime.invoke(
        "hello",
        user_id=1,
        history=[],
        dry_run=True,
    )
    assert isinstance(result, DryRunResult)
    assert "send_message" in result.allowed_tools


@pytest.mark.asyncio
async def test_dry_run_has_tool_schemas() -> None:
    runtime = _build_runtime()
    result = await runtime.invoke(
        "hello",
        user_id=1,
        history=[],
        dry_run=True,
    )
    assert isinstance(result, DryRunResult)
    assert len(result.tool_schemas) >= 1
    schema = result.tool_schemas[0]
    assert "name" in schema
    assert schema["name"] == "send_message"


@pytest.mark.asyncio
async def test_dry_run_estimated_tokens_positive() -> None:
    runtime = _build_runtime()
    result = await runtime.invoke(
        "hello",
        user_id=1,
        history=[],
        dry_run=True,
    )
    assert isinstance(result, DryRunResult)
    assert result.estimated_prompt_tokens > 0


@pytest.mark.asyncio
async def test_dry_run_with_memory_blocks() -> None:
    runtime = _build_runtime()
    blocks = (
        MemoryBlock(label="core_memory", value="User likes Python"),
        MemoryBlock(label="working_memory", value="Current project: animaOS"),
    )
    result = await runtime.invoke(
        "hello",
        user_id=1,
        history=[],
        memory_blocks=blocks,
        dry_run=True,
    )
    assert isinstance(result, DryRunResult)
    assert len(result.memory_blocks) == 2


@pytest.mark.asyncio
async def test_dry_run_does_not_call_llm() -> None:
    """NeverCalledAdapter would raise if LLM is invoked."""
    runtime = _build_runtime()
    # This should NOT raise — if it does, the LLM was called
    result = await runtime.invoke(
        "hello",
        user_id=1,
        history=[],
        dry_run=True,
    )
    assert isinstance(result, DryRunResult)


@pytest.mark.asyncio
async def test_dry_run_prompt_budget() -> None:
    runtime = _build_runtime()
    result = await runtime.invoke(
        "hello",
        user_id=1,
        history=[],
        dry_run=True,
    )
    assert isinstance(result, DryRunResult)
    # prompt_budget may be None (depends on model config) but should not raise
    # If present, it should have system_prompt_token_estimate
    if result.prompt_budget is not None:
        assert result.prompt_budget.system_prompt_token_estimate >= 0
