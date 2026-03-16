"""Integration tests for the full cognitive pipeline:
think → act → respond, with memory persistence and inner thought extraction."""

from __future__ import annotations

import asyncio
from collections import deque
from collections.abc import Generator
from contextlib import contextmanager
from unittest.mock import MagicMock

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from anima_server.db.base import Base
from anima_server.models import SelfModelBlock, User
from anima_server.services.agent.adapters.base import BaseLLMAdapter
from anima_server.services.agent.executor import ToolExecutor
from anima_server.services.agent.memory_blocks import MemoryBlock
from anima_server.services.agent.rules import InitToolRule, TerminalToolRule
from anima_server.services.agent.runtime import AgentRuntime
from anima_server.services.agent.runtime_types import (
    LLMRequest,
    StepExecutionResult,
    StopReason,
    ToolCall,
    ToolExecutionResult,
)
from anima_server.services.agent.state import AgentResult
from anima_server.services.agent.tool_context import ToolContext, clear_tool_context, set_tool_context
from anima_server.services.agent.tools import (
    core_memory_append,
    core_memory_replace,
    inner_thought,
    send_message,
    tool,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class QueueAdapter(BaseLLMAdapter):
    provider = "test"
    model = "test-model"

    def __init__(self, responses: list[StepExecutionResult]) -> None:
        self._responses = deque(responses)
        self.requests: list[LLMRequest] = []

    async def invoke(self, request: LLMRequest) -> StepExecutionResult:
        self.requests.append(request)
        if not self._responses:
            raise AssertionError("No queued responses.")
        return self._responses.popleft()


@contextmanager
def _db_session() -> Generator[Session, None, None]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    factory = sessionmaker(
        bind=engine,
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
        class_=Session,
    )
    Base.metadata.create_all(bind=engine)
    session = factory()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


# ---------------------------------------------------------------------------
# Integration: think → core_memory_append → send_message
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_think_append_memory_respond_pipeline() -> None:
    """Full pipeline: inner_thought → core_memory_append → send_message.
    Verifies memory is actually written to DB and visible in the next step."""

    with _db_session() as db:
        user = User(username="pipeline", password_hash="x", display_name="Test")
        db.add(user)
        db.flush()

        # Seed a human memory block
        db.add(SelfModelBlock(
            user_id=user.id,
            section="human",
            content="Name: Alice",
            version=1,
            updated_by="seed",
        ))
        db.commit()

        set_tool_context(ToolContext(db=db, user_id=user.id, thread_id=1))
        try:
            # Step 1: think
            # Step 2: core_memory_append
            # Step 3: send_message
            adapter = QueueAdapter([
                StepExecutionResult(
                    tool_calls=(ToolCall(
                        id="c1", name="inner_thought",
                        arguments={"thought": "User mentioned they have a dog named Biscuit."},
                    ),)
                ),
                StepExecutionResult(
                    tool_calls=(ToolCall(
                        id="c2", name="core_memory_append",
                        arguments={"label": "human", "content": "Has a dog named Biscuit."},
                    ),)
                ),
                StepExecutionResult(
                    tool_calls=(ToolCall(
                        id="c3", name="send_message",
                        arguments={"message": "Biscuit sounds adorable!"},
                    ),)
                ),
            ])

            # Custom executor that propagates memory_modified from real tools
            class RealToolExecutor(ToolExecutor):
                async def execute(self, tool_call, *, is_terminal=False):
                    result = await super().execute(tool_call, is_terminal=is_terminal)
                    return result

            runtime = AgentRuntime(
                adapter=adapter,
                tools=[inner_thought, core_memory_append, send_message],
                tool_rules=[
                    InitToolRule(tool_name="inner_thought"),
                    TerminalToolRule(tool_name="send_message"),
                ],
                tool_executor=RealToolExecutor([inner_thought, core_memory_append, send_message]),
                max_steps=5,
            )

            # Memory refresher that reads from DB
            async def refresher():
                block = db.scalar(
                    select(SelfModelBlock).where(
                        SelfModelBlock.user_id == user.id,
                        SelfModelBlock.section == "human",
                    )
                )
                if block is None:
                    return None
                return (MemoryBlock(
                    label="human",
                    value=block.content,
                    description="User understanding",
                ),)

            result = await runtime.invoke(
                "I just got a rescue dog named Biscuit!",
                user_id=user.id,
                history=[],
                memory_blocks=(MemoryBlock(
                    label="human",
                    value="Name: Alice",
                    description="User understanding",
                ),),
                memory_refresher=refresher,
            )

            # Verify the response
            assert result.response == "Biscuit sounds adorable!"
            assert result.stop_reason == StopReason.TERMINAL_TOOL.value
            assert len(result.step_traces) == 3

            # Verify the memory was actually persisted to DB
            block = db.scalar(
                select(SelfModelBlock).where(
                    SelfModelBlock.user_id == user.id,
                    SelfModelBlock.section == "human",
                )
            )
            assert block is not None
            assert "Biscuit" in block.content
            assert "Alice" in block.content  # original content preserved

            # Verify the inner thought is in the step traces
            assert result.step_traces[0].tool_calls[0].name == "inner_thought"
            assert "Biscuit" in result.step_traces[0].tool_calls[0].arguments["thought"]

        finally:
            clear_tool_context()


@pytest.mark.asyncio
async def test_core_memory_replace_pipeline() -> None:
    """Pipeline: think → core_memory_replace → send_message."""

    with _db_session() as db:
        user = User(username="replace", password_hash="x", display_name="Test")
        db.add(user)
        db.flush()

        db.add(SelfModelBlock(
            user_id=user.id,
            section="human",
            content="Works at Google",
            version=1,
            updated_by="seed",
        ))
        db.commit()

        set_tool_context(ToolContext(db=db, user_id=user.id, thread_id=1))
        try:
            adapter = QueueAdapter([
                StepExecutionResult(
                    tool_calls=(ToolCall(
                        id="c1", name="inner_thought",
                        arguments={"thought": "User switched jobs to Apple."},
                    ),)
                ),
                StepExecutionResult(
                    tool_calls=(ToolCall(
                        id="c2", name="core_memory_replace",
                        arguments={
                            "label": "human",
                            "old_text": "Works at Google",
                            "new_text": "Works at Apple (switched March 2026)",
                        },
                    ),)
                ),
                StepExecutionResult(
                    tool_calls=(ToolCall(
                        id="c3", name="send_message",
                        arguments={"message": "Congrats on the new role at Apple!"},
                    ),)
                ),
            ])

            runtime = AgentRuntime(
                adapter=adapter,
                tools=[inner_thought, core_memory_replace, send_message],
                tool_rules=[
                    InitToolRule(tool_name="inner_thought"),
                    TerminalToolRule(tool_name="send_message"),
                ],
                max_steps=5,
            )

            result = await runtime.invoke(
                "I just started at Apple!",
                user_id=user.id,
                history=[],
            )

            assert result.response == "Congrats on the new role at Apple!"

            block = db.scalar(
                select(SelfModelBlock).where(
                    SelfModelBlock.user_id == user.id,
                    SelfModelBlock.section == "human",
                )
            )
            assert "Apple" in block.content
            assert "Google" not in block.content

        finally:
            clear_tool_context()


# ---------------------------------------------------------------------------
# Inner thought extraction for consolidation
# ---------------------------------------------------------------------------


def test_extract_inner_thoughts_from_traces() -> None:
    """_extract_inner_thoughts pulls thought content from step traces."""
    from anima_server.services.agent.service import _extract_inner_thoughts
    from anima_server.services.agent.runtime_types import StepTrace

    result = AgentResult(
        response="Hello!",
        model="test",
        provider="test",
        stop_reason="terminal_tool",
        tools_used=["inner_thought", "send_message"],
        step_traces=[
            StepTrace(
                step_index=0,
                tool_calls=(ToolCall(
                    id="c1", name="inner_thought",
                    arguments={"thought": "User seems happy today."},
                ),),
            ),
            StepTrace(
                step_index=1,
                tool_calls=(ToolCall(
                    id="c2", name="send_message",
                    arguments={"message": "Hey!"},
                ),),
            ),
        ],
    )

    thoughts = _extract_inner_thoughts(result)
    assert "User seems happy today." in thoughts


def test_extract_inner_thoughts_empty_when_no_thoughts() -> None:
    """No inner_thought calls means empty string."""
    from anima_server.services.agent.service import _extract_inner_thoughts
    from anima_server.services.agent.runtime_types import StepTrace

    result = AgentResult(
        response="Hi",
        model="test",
        provider="test",
        stop_reason="end_turn",
        tools_used=[],
        step_traces=[
            StepTrace(step_index=0, assistant_text="Hi"),
        ],
    )

    assert _extract_inner_thoughts(result) == ""


# ---------------------------------------------------------------------------
# Deep monologue persona evolution
# ---------------------------------------------------------------------------


def test_deep_monologue_result_tracks_persona() -> None:
    """DeepMonologueResult has a persona_updated field."""
    from anima_server.services.agent.inner_monologue import DeepMonologueResult
    r = DeepMonologueResult()
    assert r.persona_updated is False
    r.persona_updated = True
    assert r.persona_updated is True


def test_deep_monologue_prompt_includes_persona() -> None:
    """The deep monologue prompt template includes a persona section."""
    from anima_server.services.agent.inner_monologue import DEEP_MONOLOGUE_PROMPT
    assert "{persona}" in DEEP_MONOLOGUE_PROMPT
    assert "persona_update" in DEEP_MONOLOGUE_PROMPT
    assert "EVOLVE" in DEEP_MONOLOGUE_PROMPT
