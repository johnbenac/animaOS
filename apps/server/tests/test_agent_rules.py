from __future__ import annotations

from anima_server.services.agent.rules import (
    ChildToolRule,
    InitToolRule,
    RequiresApprovalToolRule,
    TerminalToolRule,
    ToolRulesSolver,
)


def test_tool_rules_solver_enforces_init_and_child_rules() -> None:
    solver = ToolRulesSolver(
        [
            InitToolRule(tool_name="think"),
            ChildToolRule(
                tool_name="think",
                children=("current_datetime", "send_message"),
            ),
            TerminalToolRule(tool_name="send_message"),
        ]
    )
    all_tools = {"think", "current_datetime", "send_message", "search_memory"}

    assert solver.get_allowed_tools(all_tools) == {"think"}
    assert solver.should_force_tool_call() is True
    assert solver.validate_tool_call("current_datetime", all_tools) == (
        "Tool 'current_datetime' is not allowed yet. "
        "The first tool call must be one of: think."
    )

    solver.update_state("think", "planned")

    assert solver.call_history == ("think",)
    assert solver.last_tool_return_value == "planned"
    assert solver.get_allowed_tools(all_tools) == {"current_datetime", "send_message"}
    assert solver.should_force_tool_call() is True
    assert solver.is_terminal("send_message") is True
    assert solver.validate_tool_call("search_memory", all_tools) == (
        "Tool 'search_memory' is not allowed after 'think'. "
        "Allowed next tools: current_datetime, send_message."
    )


def test_tool_rules_solver_tracks_approval_and_unknown_tools() -> None:
    solver = ToolRulesSolver(
        [
            RequiresApprovalToolRule(tool_name="delete_file"),
            TerminalToolRule(tool_name="send_message"),
        ]
    )
    all_tools = {"delete_file", "send_message"}

    assert solver.requires_approval("delete_file") is True
    assert solver.get_allowed_tools(all_tools) == all_tools
    assert solver.validate_tool_call("unknown_tool", all_tools) == (
        "Tool 'unknown_tool' is not registered for this agent."
    )
