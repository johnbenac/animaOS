from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

from jinja2 import Environment, StrictUndefined, Template


@dataclass(frozen=True, slots=True)
class SystemPromptContext:
    tool_summaries: Sequence[str] = field(default_factory=tuple)
    user_context: str = ""
    additional_instructions: Sequence[str] = field(default_factory=tuple)
    now: datetime | None = None


TEMPLATE_PATH = Path(__file__).with_name("templates") / "system_prompt.md.j2"


def build_system_prompt(
    context: SystemPromptContext | None = None,
) -> str:
    resolved = context or SystemPromptContext()
    now = resolved.now or datetime.now(UTC)
    template_context = {
        "tool_summaries": [item.strip() for item in resolved.tool_summaries if item.strip()],
        "user_context": resolved.user_context.strip(),
        "additional_instructions": [
            item.strip() for item in resolved.additional_instructions if item.strip()
        ],
        "now_iso": now.isoformat(),
    }
    return render_system_prompt_template(template_context)


def invalidate_system_prompt_template_cache() -> None:
    get_system_prompt_template.cache_clear()


def render_system_prompt_template(context: dict[str, Any]) -> str:
    return get_system_prompt_template().render(**context).strip()


@lru_cache(maxsize=1)
def get_system_prompt_template() -> Template:
    template_source = TEMPLATE_PATH.read_text(encoding="utf-8")
    environment = Environment(
        undefined=StrictUndefined,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    return environment.from_string(template_source)
