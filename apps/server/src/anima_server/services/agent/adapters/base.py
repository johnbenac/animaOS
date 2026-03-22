from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator

from anima_server.services.agent.runtime_types import (
    LLMRequest,
    StepExecutionResult,
    StepStreamEvent,
)


class BaseLLMAdapter(ABC):
    provider: str
    model: str

    def prepare(self) -> None:  # noqa: B027
        """Validate adapter readiness before the runtime starts."""

    @abstractmethod
    async def invoke(self, request: LLMRequest) -> StepExecutionResult:
        """Execute one model step and normalize the result."""

    async def stream(self, request: LLMRequest) -> AsyncGenerator[StepStreamEvent, None]:
        """Stream model output when supported, otherwise yield one final result."""
        yield StepStreamEvent(result=await self.invoke(request))
