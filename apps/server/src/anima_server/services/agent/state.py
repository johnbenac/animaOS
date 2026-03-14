from __future__ import annotations

from dataclasses import dataclass, field

from anima_server.services.agent.prompt_budget import PromptBudgetTrace
from anima_server.services.agent.runtime_types import StepTrace, ToolCall


@dataclass(frozen=True, slots=True)
class StoredMessage:
    role: str
    content: str
    tool_name: str | None = None
    tool_call_id: str | None = None
    tool_calls: tuple[ToolCall, ...] = field(default_factory=tuple)


@dataclass(slots=True)
class AgentResult:
    response: str
    model: str
    provider: str
    stop_reason: str | None = None
    tools_used: list[str] = field(default_factory=list)
    step_traces: list[StepTrace] = field(default_factory=list)
    prompt_budget: PromptBudgetTrace | None = None
