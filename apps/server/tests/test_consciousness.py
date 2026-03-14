"""Tests for the consciousness layer: self-model, emotional intelligence, intentions, inner monologue."""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from anima_server.db.base import Base
from anima_server.models import AgentThread, User


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


def _setup(db: Session) -> tuple[User, AgentThread]:
    user = User(username="consciousness-test", display_name="Tester", password_hash="x")
    db.add(user)
    db.flush()
    thread = AgentThread(user_id=user.id, status="active")
    db.add(thread)
    db.flush()
    return user, thread


# --- Self-Model Tests ---


def test_seed_self_model() -> None:
    with _db_session() as db:
        user, _ = _setup(db)
        from anima_server.services.agent.self_model import seed_self_model, SECTIONS

        blocks = seed_self_model(db, user_id=user.id)
        assert set(blocks.keys()) == set(SECTIONS)
        assert blocks["identity"].version == 1
        assert "Who I Am" in blocks["identity"].content
        assert blocks["growth_log"].content == ""


def test_seed_self_model_idempotent() -> None:
    with _db_session() as db:
        user, _ = _setup(db)
        from anima_server.services.agent.self_model import seed_self_model

        blocks1 = seed_self_model(db, user_id=user.id)
        blocks2 = seed_self_model(db, user_id=user.id)
        assert blocks1["identity"].id == blocks2["identity"].id


def test_set_self_model_block_bumps_version() -> None:
    with _db_session() as db:
        user, _ = _setup(db)
        from anima_server.services.agent.self_model import seed_self_model, set_self_model_block

        seed_self_model(db, user_id=user.id)
        block = set_self_model_block(
            db, user_id=user.id, section="identity",
            content="Updated identity", updated_by="sleep_time",
        )
        assert block.version == 2
        assert block.content == "Updated identity"
        assert block.updated_by == "sleep_time"


def test_get_all_self_model_blocks() -> None:
    with _db_session() as db:
        user, _ = _setup(db)
        from anima_server.services.agent.self_model import seed_self_model, get_all_self_model_blocks

        seed_self_model(db, user_id=user.id)
        blocks = get_all_self_model_blocks(db, user_id=user.id)
        assert len(blocks) == 5
        assert "identity" in blocks
        assert "inner_state" in blocks


def test_append_growth_log_entry() -> None:
    with _db_session() as db:
        user, _ = _setup(db)
        from anima_server.services.agent.self_model import seed_self_model, append_growth_log_entry

        seed_self_model(db, user_id=user.id)
        block = append_growth_log_entry(
            db, user_id=user.id,
            entry="Communication style refined",
        )
        assert "Communication style refined" in block.content
        assert block.version == 2


def test_ensure_self_model_exists() -> None:
    with _db_session() as db:
        user, _ = _setup(db)
        from anima_server.services.agent.self_model import ensure_self_model_exists, get_all_self_model_blocks

        ensure_self_model_exists(db, user_id=user.id)
        blocks = get_all_self_model_blocks(db, user_id=user.id)
        assert len(blocks) == 5

        # Second call is a no-op
        ensure_self_model_exists(db, user_id=user.id)
        blocks2 = get_all_self_model_blocks(db, user_id=user.id)
        assert len(blocks2) == 5


def test_render_self_model_section_budget() -> None:
    with _db_session() as db:
        user, _ = _setup(db)
        from anima_server.services.agent.self_model import seed_self_model, set_self_model_block, render_self_model_section

        seed_self_model(db, user_id=user.id)
        long_content = "x" * 5000
        block = set_self_model_block(
            db, user_id=user.id, section="identity",
            content=long_content, updated_by="test",
        )
        rendered = render_self_model_section(block, budget=100)
        assert len(rendered) == 100


# --- Emotional Intelligence Tests ---


def test_record_emotional_signal() -> None:
    with _db_session() as db:
        user, thread = _setup(db)
        from anima_server.services.agent.emotional_intelligence import record_emotional_signal

        signal = record_emotional_signal(
            db, user_id=user.id, thread_id=thread.id,
            emotion="frustrated", confidence=0.8,
            evidence_type="linguistic", evidence="shorter messages, repetition",
            trajectory="escalating", topic="debugging",
        )
        assert signal is not None
        assert signal.emotion == "frustrated"
        assert signal.confidence == 0.8
        assert signal.trajectory == "escalating"


def test_emotional_signal_below_threshold_ignored() -> None:
    with _db_session() as db:
        user, thread = _setup(db)
        from anima_server.services.agent.emotional_intelligence import record_emotional_signal

        signal = record_emotional_signal(
            db, user_id=user.id, thread_id=thread.id,
            emotion="calm", confidence=0.2,
        )
        assert signal is None


def test_invalid_emotion_rejected() -> None:
    with _db_session() as db:
        user, thread = _setup(db)
        from anima_server.services.agent.emotional_intelligence import record_emotional_signal

        signal = record_emotional_signal(
            db, user_id=user.id, thread_id=thread.id,
            emotion="supercalifragilistic", confidence=0.9,
        )
        assert signal is None


def test_emotional_signal_buffer_trimmed() -> None:
    with _db_session() as db:
        user, thread = _setup(db)
        from anima_server.services.agent.emotional_intelligence import record_emotional_signal, get_recent_signals

        # Record more than buffer size (default 20)
        for i in range(25):
            record_emotional_signal(
                db, user_id=user.id, thread_id=thread.id,
                emotion="calm", confidence=0.5,
            )

        signals = get_recent_signals(db, user_id=user.id)
        assert len(signals) <= 20


def test_synthesize_emotional_context() -> None:
    with _db_session() as db:
        user, thread = _setup(db)
        from anima_server.services.agent.emotional_intelligence import (
            record_emotional_signal,
            synthesize_emotional_context,
        )

        record_emotional_signal(
            db, user_id=user.id, thread_id=thread.id,
            emotion="stressed", confidence=0.8,
            evidence="mentions deadline multiple times",
            topic="work review",
        )
        record_emotional_signal(
            db, user_id=user.id, thread_id=thread.id,
            emotion="anxious", confidence=0.7,
            trajectory="escalating",
            topic="presentation prep",
        )

        context = synthesize_emotional_context(db, user_id=user.id)
        assert "anxious" in context or "stressed" in context
        assert len(context) > 0


def test_trajectory_auto_detection() -> None:
    with _db_session() as db:
        user, thread = _setup(db)
        from anima_server.services.agent.emotional_intelligence import record_emotional_signal, get_latest_signal

        # First signal
        record_emotional_signal(
            db, user_id=user.id, thread_id=thread.id,
            emotion="calm", confidence=0.6,
        )

        # Second signal with different emotion should auto-detect "shifted"
        signal = record_emotional_signal(
            db, user_id=user.id, thread_id=thread.id,
            emotion="frustrated", confidence=0.7,
        )
        assert signal is not None
        assert signal.trajectory == "shifted"
        assert signal.previous_emotion == "calm"


# --- Intentions Tests ---


def test_add_intention() -> None:
    with _db_session() as db:
        user, _ = _setup(db)
        from anima_server.services.agent.self_model import seed_self_model
        from anima_server.services.agent.intentions import add_intention

        seed_self_model(db, user_id=user.id)
        content = add_intention(
            db, user_id=user.id,
            title="Help prepare Q2 review",
            evidence="Mentioned deadline 3 times",
            priority="high",
            deadline="2026-03-20",
        )
        assert "Help prepare Q2 review" in content
        assert "2026-03-20" in content


def test_complete_intention() -> None:
    with _db_session() as db:
        user, _ = _setup(db)
        from anima_server.services.agent.self_model import seed_self_model
        from anima_server.services.agent.intentions import add_intention, complete_intention

        seed_self_model(db, user_id=user.id)
        add_intention(
            db, user_id=user.id,
            title="Write report",
            priority="ongoing",
        )
        found = complete_intention(db, user_id=user.id, title="Write report")
        assert found is True


def test_complete_nonexistent_intention() -> None:
    with _db_session() as db:
        user, _ = _setup(db)
        from anima_server.services.agent.self_model import seed_self_model
        from anima_server.services.agent.intentions import complete_intention

        seed_self_model(db, user_id=user.id)
        found = complete_intention(db, user_id=user.id, title="nonexistent goal")
        assert found is False


def test_add_procedural_rule() -> None:
    with _db_session() as db:
        user, _ = _setup(db)
        from anima_server.services.agent.self_model import seed_self_model
        from anima_server.services.agent.intentions import add_procedural_rule

        seed_self_model(db, user_id=user.id)
        content = add_procedural_rule(
            db, user_id=user.id,
            rule="Lead with the answer, then explain",
            evidence="User interrupted explanation 3 times",
            confidence="high",
        )
        assert "Lead with the answer" in content
        assert "Derived:" in content


def test_duplicate_intention_skipped() -> None:
    with _db_session() as db:
        user, _ = _setup(db)
        from anima_server.services.agent.self_model import seed_self_model
        from anima_server.services.agent.intentions import add_intention

        seed_self_model(db, user_id=user.id)
        add_intention(db, user_id=user.id, title="Build trust")
        content = add_intention(db, user_id=user.id, title="Build trust")
        # Should appear only once
        assert content.count("**Build trust**") == 1


# --- Memory Blocks Integration Tests ---


def test_self_model_memory_blocks_created() -> None:
    with _db_session() as db:
        user, thread = _setup(db)
        from anima_server.services.agent.memory_blocks import build_self_model_memory_blocks

        blocks = build_self_model_memory_blocks(db, user_id=user.id)
        labels = {b.label for b in blocks}
        # Should have at least identity, inner_state, working_memory, intentions
        assert "self_identity" in labels
        assert "self_inner_state" in labels
        assert "self_intentions" in labels


def test_emotional_context_block_empty_when_no_signals() -> None:
    with _db_session() as db:
        user, _ = _setup(db)
        from anima_server.services.agent.memory_blocks import build_emotional_context_block

        block = build_emotional_context_block(db, user_id=user.id)
        assert block is None


def test_emotional_context_block_created_with_signals() -> None:
    with _db_session() as db:
        user, thread = _setup(db)
        from anima_server.services.agent.emotional_intelligence import record_emotional_signal
        from anima_server.services.agent.memory_blocks import build_emotional_context_block

        record_emotional_signal(
            db, user_id=user.id, thread_id=thread.id,
            emotion="excited", confidence=0.9,
            evidence="multiple exclamation marks, long messages",
        )
        block = build_emotional_context_block(db, user_id=user.id)
        assert block is not None
        assert "excited" in block.value


# --- Growth Log Tests ---


def test_growth_log_trimming() -> None:
    with _db_session() as db:
        user, _ = _setup(db)
        from anima_server.services.agent.self_model import seed_self_model, append_growth_log_entry, get_self_model_block

        seed_self_model(db, user_id=user.id)
        for i in range(25):
            append_growth_log_entry(
                db, user_id=user.id,
                entry=f"Change number {i}",
                max_entries=10,
            )

        block = get_self_model_block(db, user_id=user.id, section="growth_log")
        assert block is not None
        entries = [e for e in block.content.split("### ") if e.strip()]
        assert len(entries) <= 10


# --- Working Memory Expiry Tests ---


def test_expire_working_memory_items_removes_expired() -> None:
    with _db_session() as db:
        user, _ = _setup(db)
        from anima_server.services.agent.self_model import (
            seed_self_model,
            set_self_model_block,
            get_self_model_block,
            expire_working_memory_items,
        )

        seed_self_model(db, user_id=user.id)
        content = (
            "# Things I'm Holding in Mind\n"
            "- Remember to ask about project [expires: 2020-01-01]\n"
            "- Follow up on meeting [expires: 2099-12-31]\n"
            "- No expiry item here\n"
        )
        set_self_model_block(
            db, user_id=user.id, section="working_memory",
            content=content, updated_by="test",
        )

        removed = expire_working_memory_items(db, user_id=user.id)
        assert removed == 1

        block = get_self_model_block(db, user_id=user.id, section="working_memory")
        assert block is not None
        assert "project" not in block.content
        assert "meeting" in block.content
        assert "No expiry item" in block.content


def test_expire_working_memory_noop_when_nothing_expired() -> None:
    with _db_session() as db:
        user, _ = _setup(db)
        from anima_server.services.agent.self_model import (
            seed_self_model,
            set_self_model_block,
            expire_working_memory_items,
        )

        seed_self_model(db, user_id=user.id)
        content = "# Things I'm Holding in Mind\n- Future item [expires: 2099-12-31]\n"
        set_self_model_block(
            db, user_id=user.id, section="working_memory",
            content=content, updated_by="test",
        )

        removed = expire_working_memory_items(db, user_id=user.id)
        assert removed == 0


# --- Feedback Signal Tests ---


def test_detect_correction_signal() -> None:
    from anima_server.services.agent.feedback_signals import detect_correction

    signal = detect_correction("No, that's not what I asked. I want the summary.")
    assert signal is not None
    assert signal.signal_type == "correction"

    signal = detect_correction("Thanks, that's great!")
    assert signal is None


def test_detect_reask_signal() -> None:
    from anima_server.services.agent.feedback_signals import detect_reask

    signal = detect_reask(
        "What is the status of my project deadline?",
        ["What is the current status of my project deadline?"],
    )
    assert signal is not None
    assert signal.signal_type == "re_ask"

    signal = detect_reask(
        "What is the weather today?",
        ["Tell me about quantum physics"],
    )
    assert signal is None


def test_collect_feedback_signals_with_correction() -> None:
    with _db_session() as db:
        user, thread = _setup(db)
        from anima_server.services.agent.feedback_signals import collect_feedback_signals

        signals = collect_feedback_signals(
            db,
            user_id=user.id,
            user_message="No, I said I wanted the shorter version",
            thread_id=thread.id,
        )
        assert len(signals) >= 1
        assert any(s.signal_type == "correction" for s in signals)


def test_record_feedback_signals_to_growth_log() -> None:
    with _db_session() as db:
        user, _ = _setup(db)
        from anima_server.services.agent.feedback_signals import (
            FeedbackSignal,
            record_feedback_signals,
        )
        from anima_server.services.agent.self_model import get_self_model_block

        signals = [
            FeedbackSignal(
                signal_type="correction",
                evidence="User corrected the output format",
                topic="formatting",
                severity=0.7,
            ),
        ]
        recorded = record_feedback_signals(db, user_id=user.id, signals=signals)
        assert recorded == 1

        block = get_self_model_block(db, user_id=user.id, section="growth_log")
        assert block is not None
        assert "correction" in block.content


# --- Dynamic Identity in System Prompt Tests ---


def test_dynamic_identity_flows_into_system_prompt() -> None:
    from anima_server.services.agent.memory_blocks import MemoryBlock
    from anima_server.services.agent.system_prompt import SystemPromptContext, build_system_prompt

    identity_block = MemoryBlock(
        label="self_identity",
        description="Who I am.",
        value="I am deeply curious about this user's creative projects.",
    )
    other_block = MemoryBlock(
        label="facts",
        description="Known facts.",
        value="- Works as an artist",
    )

    prompt = build_system_prompt(
        SystemPromptContext(
            memory_blocks=(identity_block, other_block),
        )
    )

    # Identity should appear in the dynamic persona section, not in memory blocks
    assert "deeply curious about this user" in prompt
    assert "My Self-Understanding" in prompt
    # The facts block should still be in memory blocks
    assert "Works as an artist" in prompt


def test_semantic_memory_block_built_from_results() -> None:
    from anima_server.services.agent.memory_blocks import _build_semantic_block

    results = [
        (1, "Works as a software engineer at Google", 0.92),
        (2, "Enjoys hiking on weekends", 0.78),
    ]
    block = _build_semantic_block(results)
    assert block is not None
    assert block.label == "relevant_memories"
    assert "software engineer" in block.value
    assert "hiking" in block.value
    assert "0.92" in block.value


def test_semantic_memory_block_empty_returns_none() -> None:
    from anima_server.services.agent.memory_blocks import _build_semantic_block

    assert _build_semantic_block([]) is None


def test_greeting_context_gathered() -> None:
    with _db_session() as db:
        user, thread = _setup(db)
        db.commit()
        from anima_server.services.agent.proactive import gather_greeting_context

        ctx = gather_greeting_context(db, user_id=user.id)
        assert ctx.open_task_count == 0
        assert ctx.overdue_task_count == 0
        assert ctx.days_since_last_chat is None


def test_static_greeting_with_focus() -> None:
    from anima_server.services.agent.proactive import GreetingContext, build_static_greeting

    ctx = GreetingContext(
        current_focus="finishing the migration",
        open_task_count=3,
        days_since_last_chat=5,
    )
    greeting = build_static_greeting(ctx)
    assert "migration" in greeting
    assert "3 open tasks" in greeting
    assert "5 days" in greeting


def test_static_greeting_empty_context() -> None:
    from anima_server.services.agent.proactive import GreetingContext, build_static_greeting

    ctx = GreetingContext()
    greeting = build_static_greeting(ctx)
    assert "Welcome back" in greeting


def test_system_prompt_without_identity_has_no_dynamic_section() -> None:
    from anima_server.services.agent.memory_blocks import MemoryBlock
    from anima_server.services.agent.system_prompt import SystemPromptContext, build_system_prompt

    block = MemoryBlock(
        label="facts",
        description="Known facts.",
        value="- Likes coffee",
    )

    prompt = build_system_prompt(
        SystemPromptContext(
            memory_blocks=(block,),
        )
    )

    assert "My Self-Understanding" not in prompt
    assert "Likes coffee" in prompt
