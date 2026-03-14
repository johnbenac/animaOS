from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager

import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from anima_server.db.base import Base
from anima_server.models import AgentMessage, AgentRun, AgentThread, User
from anima_server.services.agent import list_agent_history, run_agent
from anima_server.services.agent.runtime_types import StepTrace
from anima_server.services.agent.state import AgentResult
from anima_server.services.agent import service as agent_service


class FailingThenReplyRunner:
    def __init__(self) -> None:
        self.calls = 0

    async def invoke(self, *args, **kwargs) -> AgentResult:  # noqa: ANN002, ANN003
        del args, kwargs
        self.calls += 1
        if self.calls == 1:
            raise RuntimeError("boom")
        return AgentResult(
            response="Recovered reply.",
            model="test-model",
            provider="test-provider",
            stop_reason="end_turn",
            step_traces=[StepTrace(step_index=0, assistant_text="Recovered reply.")],
        )


@contextmanager
def _db_session() -> Generator[Session, None, None]:
    engine: Engine = create_engine(
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


@pytest.mark.asyncio
async def test_failed_turn_retry_keeps_history_clean(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner = FailingThenReplyRunner()
    monkeypatch.setattr(agent_service, "get_or_build_runner", lambda: runner)
    monkeypatch.setattr(agent_service, "_run_post_turn_hooks", lambda **kwargs: None)

    with _db_session() as session:
        user = User(
            username="retry-me",
            password_hash="not-used",
            display_name="Retry Me",
        )
        session.add(user)
        session.commit()

        with pytest.raises(RuntimeError, match="boom"):
            await run_agent("first attempt", user.id, session)

        result = await run_agent("second attempt", user.id, session)

        thread = session.query(AgentThread).one()
        runs = session.query(AgentRun).order_by(AgentRun.id).all()
        messages = (
            session.query(AgentMessage)
            .order_by(AgentMessage.sequence_id)
            .all()
        )
        history = list_agent_history(user.id, session, limit=10)

    assert result.response == "Recovered reply."
    assert [run.status for run in runs] == ["failed", "completed"]
    assert [message.sequence_id for message in messages] == [1, 2, 3]
    assert messages[0].content_text == "first attempt"
    assert messages[0].is_in_context is False
    assert messages[1].content_text == "second attempt"
    assert messages[1].is_in_context is True
    assert messages[2].content_text == "Recovered reply."
    assert messages[2].is_in_context is True
    assert thread.next_message_sequence == 4
    assert [message.content_text for message in history] == [
        "second attempt",
        "Recovered reply.",
    ]
