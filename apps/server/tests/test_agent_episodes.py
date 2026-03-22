from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, datetime

import pytest
from anima_server.db.base import Base
from anima_server.models import MemoryDailyLog, MemoryEpisode, User
from anima_server.services.agent.episodes import maybe_generate_episode
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool


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
async def test_maybe_generate_episode_requires_minimum_turns() -> None:
    with _db_session() as session:
        user = User(
            username="episode-test",
            password_hash="not-used",
            display_name="Episode Test",
        )
        session.add(user)
        session.commit()

        eng = session.get_bind()
        test_factory = sessionmaker(
            bind=eng,
            autoflush=False,
            autocommit=False,
            expire_on_commit=False,
            class_=Session,
        )

        today = datetime.now(UTC).date().isoformat()
        session.add_all(
            [
                MemoryDailyLog(
                    user_id=user.id,
                    date=today,
                    user_message="Hello",
                    assistant_response="Hi there!",
                ),
                MemoryDailyLog(
                    user_id=user.id,
                    date=today,
                    user_message="How are you?",
                    assistant_response="I'm great!",
                ),
            ]
        )
        session.commit()

        result = await maybe_generate_episode(
            user_id=user.id,
            db_factory=test_factory,
        )
        assert result is None


@pytest.mark.asyncio
async def test_maybe_generate_episode_creates_episode_with_enough_turns() -> None:
    with _db_session() as session:
        user = User(
            username="episode-gen",
            password_hash="not-used",
            display_name="Episode Gen",
        )
        session.add(user)
        session.commit()

        eng = session.get_bind()
        test_factory = sessionmaker(
            bind=eng,
            autoflush=False,
            autocommit=False,
            expire_on_commit=False,
            class_=Session,
        )

        today = datetime.now(UTC).date().isoformat()
        session.add_all(
            [
                MemoryDailyLog(
                    user_id=user.id,
                    date=today,
                    user_message="I'm working on a project.",
                    assistant_response="Tell me more about it!",
                ),
                MemoryDailyLog(
                    user_id=user.id,
                    date=today,
                    user_message="It's an AI companion.",
                    assistant_response="Sounds fascinating.",
                ),
                MemoryDailyLog(
                    user_id=user.id,
                    date=today,
                    user_message="I want it to remember things.",
                    assistant_response="Memory is crucial for companionship.",
                ),
            ]
        )
        session.commit()

        result = await maybe_generate_episode(
            user_id=user.id,
            db_factory=test_factory,
        )
        assert result is not None
        assert result.user_id == user.id
        assert result.date == today
        assert result.turn_count == 3
        assert result.summary

        with test_factory() as db2:
            episodes = db2.query(MemoryEpisode).filter_by(user_id=user.id).all()
            assert len(episodes) == 1


@pytest.mark.asyncio
async def test_maybe_generate_episode_skips_already_episoded_turns() -> None:
    with _db_session() as session:
        user = User(
            username="episode-dedup",
            password_hash="not-used",
            display_name="Episode Dedup",
        )
        session.add(user)
        session.commit()

        eng = session.get_bind()
        test_factory = sessionmaker(
            bind=eng,
            autoflush=False,
            autocommit=False,
            expire_on_commit=False,
            class_=Session,
        )

        today = datetime.now(UTC).date().isoformat()
        session.add_all(
            [
                MemoryDailyLog(
                    user_id=user.id,
                    date=today,
                    user_message=f"Message {i}",
                    assistant_response=f"Response {i}",
                )
                for i in range(4)
            ]
        )
        session.commit()

        first = await maybe_generate_episode(
            user_id=user.id,
            db_factory=test_factory,
        )
        assert first is not None

        # Only 4 logs, first episode used 3, only 1 remaining < 3 minimum
        second = await maybe_generate_episode(
            user_id=user.id,
            db_factory=test_factory,
        )
        assert second is None
