"""Unified prompt loader for all agent prompts.

All prompts are Jinja2 templates stored in templates/prompts/.
The agent_name is automatically fetched from AgentProfile.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

from jinja2 import Environment, StrictUndefined, Template

from anima_server.models import AgentProfile

PROMPTS_DIR = Path(__file__).with_name("templates") / "prompts"


class PromptLoader:
    """Loads and renders Jinja2 prompt templates with agent context."""

    def __init__(self, agent_name: str = "Anima"):
        self.agent_name = agent_name
        self._env = Environment(
            undefined=StrictUndefined,
            trim_blocks=True,
            lstrip_blocks=True,
        )

    @classmethod
    def from_db(cls, db_session, user_id: int) -> "PromptLoader":
        """Create a PromptLoader with agent_name from the user's AgentProfile."""
        profile = db_session.get(AgentProfile, user_id)
        agent_name = profile.agent_name if profile else "Anima"
        return cls(agent_name=agent_name)

    def _load_template(self, name: str) -> Template:
        """Load a template from the prompts directory."""
        path = PROMPTS_DIR / f"{name}.md.j2"
        if not path.exists():
            raise FileNotFoundError(f"Prompt template not found: {name}")
        source = path.read_text(encoding="utf-8")
        return self._env.from_string(source)

    def render(self, template_name: str, **context: Any) -> str:
        """Render a prompt template with the given context.
        
        The agent_name is automatically added to the context.
        """
        template = self._load_template(template_name)
        full_context = {"agent_name": self.agent_name, **context}
        return template.render(**full_context).strip()

    # -----------------------------------------------------------------------
    # Pre-defined prompt renderers for convenience
    # -----------------------------------------------------------------------

    def quick_reflection(
        self,
        *,
        inner_state: str,
        working_memory: str,
        recent_episodes: str,
        conversation: str,
    ) -> str:
        """Render the quick reflection prompt."""
        return self.render(
            "quick_reflection",
            inner_state=inner_state,
            working_memory=working_memory,
            recent_episodes=recent_episodes,
            conversation=conversation,
        )

    def quick_reflection_system(self) -> str:
        """Render the system prompt for quick reflection."""
        return self.render("quick_reflection_system")

    def deep_monologue(
        self,
        *,
        identity_version: int,
        identity: str,
        persona: str,
        inner_state: str,
        working_memory: str,
        growth_log: str,
        intentions: str,
        user_facts: str,
        recent_episodes: str,
        emotional_signals: str,
    ) -> str:
        """Render the deep monologue prompt."""
        return self.render(
            "deep_monologue",
            identity_version=identity_version,
            identity=identity,
            persona=persona,
            inner_state=inner_state,
            working_memory=working_memory,
            growth_log=growth_log,
            intentions=intentions,
            user_facts=user_facts,
            recent_episodes=recent_episodes,
            emotional_signals=emotional_signals,
        )

    def deep_monologue_system(self) -> str:
        """Render the system prompt for deep monologue."""
        return self.render("deep_monologue_system")

    def memory_extraction(
        self,
        *,
        user_message: str,
        assistant_response: str,
    ) -> str:
        """Render the memory extraction prompt."""
        return self.render(
            "memory_extraction",
            user_message=user_message,
            assistant_response=assistant_response,
        )

    def conflict_check(self, *, existing: str, new_content: str) -> str:
        """Render the single conflict check prompt."""
        return self.render(
            "conflict_check",
            existing=existing,
            new_content=new_content,
        )

    def batch_conflict_check(
        self,
        *,
        existing_memories: str,
        new_content: str,
    ) -> str:
        """Render the batch conflict check prompt."""
        return self.render(
            "batch_conflict_check",
            existing_memories=existing_memories,
            new_content=new_content,
        )


def get_prompt_loader(db_session, user_id: int) -> PromptLoader:
    """Get a PromptLoader instance for the given user."""
    return PromptLoader.from_db(db_session, user_id)
