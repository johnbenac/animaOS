from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from anima_server.models import AgentThread
from anima_server.services.agent.state import AgentResult


def reserve_message_sequences(
    db: Session,
    *,
    thread_id: int,
    count: int,
) -> int:
    """Reserve a contiguous sequence range for a thread and return its start."""
    if count < 1:
        raise ValueError("count must be at least 1")

    while True:
        current_next = db.scalar(
            select(AgentThread.next_message_sequence).where(AgentThread.id == thread_id)
        )
        if current_next is None:
            raise LookupError(f"Agent thread {thread_id} does not exist.")

        start_sequence_id = int(current_next)
        result = db.execute(
            update(AgentThread)
            .where(
                AgentThread.id == thread_id,
                AgentThread.next_message_sequence == start_sequence_id,
            )
            .values(next_message_sequence=start_sequence_id + count)
        )
        if result.rowcount == 1:
            return start_sequence_id


def count_persisted_result_messages(result: AgentResult) -> int:
    count = 0
    for trace in result.step_traces:
        if trace.assistant_text or trace.tool_calls:
            count += 1
        count += len(trace.tool_results)
    return count
