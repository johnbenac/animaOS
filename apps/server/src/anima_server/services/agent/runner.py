from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from anima_server.config import settings
from anima_server.services.agent.messages import (
    build_conversation_messages,
    extract_last_ai_content,
    extract_tools_used,
)
from anima_server.services.agent.state import AgentResult, StoredMessage
from anima_server.services.agent.system_prompt import SystemPromptContext, build_system_prompt


class GraphRunner:
    """Wrap a compiled LangGraph and normalize its output."""

    def __init__(
        self,
        graph: Any,
        *,
        is_scaffold: bool = False,
        persona_template: str = "default",
        tool_summaries: Sequence[str] = (),
    ) -> None:
        self._graph = graph
        self._is_scaffold = is_scaffold
        self._persona_template = persona_template
        self._tool_summaries = tuple(tool_summaries)

    def prepare_system_prompt(self) -> str:
        return build_system_prompt(
            SystemPromptContext(
                persona_template=self._persona_template,
                tool_summaries=self._tool_summaries,
            )
        )

    async def invoke(
        self,
        user_message: str,
        user_id: int,
        history: list[StoredMessage],
    ) -> AgentResult:
        system_prompt = self.prepare_system_prompt()
        messages = build_conversation_messages(
            history,
            user_message,
            system_prompt=system_prompt,
        )
        result = await self._graph.ainvoke({"messages": messages, "user_id": user_id})

        response = extract_last_ai_content(result.get("messages", []))
        tools_used = extract_tools_used(result.get("messages", []))

        provider = "scaffold" if self._is_scaffold else settings.agent_provider
        model = "python-agent-scaffold" if self._is_scaffold else settings.agent_model

        return AgentResult(
            response=response,
            model=model,
            provider=provider,
            tools_used=tools_used,
        )
