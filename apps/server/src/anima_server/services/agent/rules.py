from __future__ import annotations

from collections.abc import Collection, Sequence
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class TerminalToolRule:
    tool_name: str


@dataclass(frozen=True, slots=True)
class InitToolRule:
    tool_name: str


@dataclass(frozen=True, slots=True)
class ChildToolRule:
    tool_name: str
    children: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class RequiresApprovalToolRule:
    tool_name: str


ToolRule = (
    TerminalToolRule
    | InitToolRule
    | ChildToolRule
    | RequiresApprovalToolRule
)


class ToolRulesSolver:
    """Stateful solver for Letta-style tool orchestration rules."""

    def __init__(self, tool_rules: Sequence[ToolRule] = ()) -> None:
        self._init_rules = tuple(
            rule for rule in tool_rules if isinstance(rule, InitToolRule)
        )
        self._terminal_tools = {
            rule.tool_name
            for rule in tool_rules
            if isinstance(rule, TerminalToolRule)
        }
        self._child_rules = {
            rule.tool_name: rule
            for rule in tool_rules
            if isinstance(rule, ChildToolRule)
        }
        self._approval_tools = {
            rule.tool_name
            for rule in tool_rules
            if isinstance(rule, RequiresApprovalToolRule)
        }
        self._call_history: list[str] = []
        self._last_tool_return_value: str | None = None

    @property
    def call_history(self) -> tuple[str, ...]:
        return tuple(self._call_history)

    @property
    def last_tool_return_value(self) -> str | None:
        return self._last_tool_return_value

    def get_allowed_tools(self, all_tools: Collection[str]) -> set[str]:
        available_tools = _normalize_tool_names(all_tools)
        if not available_tools:
            return set()

        if not self._call_history and self._init_rules:
            return {
                rule.tool_name
                for rule in self._init_rules
                if rule.tool_name in available_tools
            }

        if self._call_history:
            last_tool = self._call_history[-1]
            child_rule = self._child_rules.get(last_tool)
            if child_rule is not None:
                return {
                    child
                    for child in child_rule.children
                    if child in available_tools
                }

        return set(available_tools)

    def should_force_tool_call(self) -> bool:
        if not self._call_history and self._init_rules:
            return True
        if self._call_history and self._call_history[-1] in self._child_rules:
            return True
        return False

    def is_terminal(self, tool_name: str) -> bool:
        return tool_name in self._terminal_tools

    def requires_approval(self, tool_name: str) -> bool:
        return tool_name in self._approval_tools

    def validate_tool_call(
        self,
        tool_name: str,
        all_tools: Collection[str],
    ) -> str | None:
        normalized_name = tool_name.strip()
        if not normalized_name:
            return "Tool name is empty."

        available_tools = _normalize_tool_names(all_tools)
        if normalized_name not in available_tools:
            return f"Tool {normalized_name!r} is not registered for this agent."

        allowed_tools = self.get_allowed_tools(available_tools)
        if normalized_name in allowed_tools:
            return None

        if not self._call_history and self._init_rules:
            init_tools = ", ".join(
                sorted(
                    rule.tool_name
                    for rule in self._init_rules
                    if rule.tool_name in available_tools
                )
            )
            return (
                f"Tool {normalized_name!r} is not allowed yet. "
                f"The first tool call must be one of: {init_tools}."
            )

        if self._call_history:
            last_tool = self._call_history[-1]
            child_rule = self._child_rules.get(last_tool)
            if child_rule is not None:
                children = ", ".join(child_rule.children)
                return (
                    f"Tool {normalized_name!r} is not allowed after {last_tool!r}. "
                    f"Allowed next tools: {children}."
                )

        allowed_display = ", ".join(sorted(allowed_tools))
        return (
            f"Tool {normalized_name!r} is not allowed right now. "
            f"Allowed tools: {allowed_display}."
        )

    def update_state(self, tool_name: str, return_value: str | None = None) -> None:
        normalized_name = tool_name.strip()
        if not normalized_name:
            return
        self._call_history.append(normalized_name)
        self._last_tool_return_value = return_value


def build_default_tool_rules(tool_names: Collection[str]) -> tuple[ToolRule, ...]:
    normalized_tools = _normalize_tool_names(tool_names)
    rules: list[ToolRule] = []
    if "send_message" in normalized_tools:
        rules.append(TerminalToolRule(tool_name="send_message"))
    return tuple(rules)


def _normalize_tool_names(tool_names: Collection[str]) -> set[str]:
    normalized: set[str] = set()
    for tool_name in tool_names:
        name = str(tool_name).strip()
        if name:
            normalized.add(name)
    return normalized
