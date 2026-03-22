---
title: Agent Tools
description: The 15 tools available to the LLM agent during conversation
category: architecture
updated: 2026-03-23
---

# Agent Tools

[Back to Index](README.md)

The LLM agent has access to 15 tools during conversation, organized into 6 core tools and 9 extension tools. Defined in `services/agent/tools.py`.

## Tool Architecture

Every tool schema has two injected parameters that the tool functions never see:

1. **`thinking`** (required string, first parameter) -- The agent's private inner monologue. Injected by `inject_inner_thoughts_into_tools()`. Stripped by `unpack_inner_thoughts_from_kwargs()` in the executor before dispatch. Stored in `ToolExecutionResult.inner_thinking` for consolidation and tracing.

2. **`request_heartbeat`** (optional boolean, last parameter, non-terminal tools only) -- When `true`, requests another step after this tool executes. Injected by `inject_heartbeat_into_tools()`. Stripped by `unpack_heartbeat_from_kwargs()` in the executor. Controls loop continuation.

## Core Tools (6)

These are the AI's fundamental capabilities -- communicate, remember, learn, persist.

| Tool | Signature | Purpose |
|------|-----------|---------|
| `send_message` | `(message: str)` | Final response to user, ends turn (terminal tool) |
| `recall_memory` | `(query: str, category?: str, tags?: str, page?: str, count?: str)` | Hybrid search (semantic + keyword) across memories and episodes, with pagination |
| `recall_conversation` | `(query: str, role?: str, start_date?: str, end_date?: str, limit?: str)` | Search past conversation history |
| `core_memory_append` | `(label: str, content: str)` | Append to human or persona memory block (immediate, in-context) |
| `core_memory_replace` | `(label: str, old_text: str, new_text: str)` | Replace text in human or persona memory block (immediate, in-context) |
| `save_to_memory` | `(key: str, category?: str, importance?: str, tags?: str)` | Promote a session note to permanent long-term memory |

## Extension Tools (9)

Optional tools for task management, intentions, session notes, and utility.

| Tool | Signature | Purpose |
|------|-----------|---------|
| `create_task` | `(text: str, due_date?: str, priority?: str)` | Add to user's task list |
| `list_tasks` | `(include_done?: str)` | View open tasks |
| `complete_task` | `(text: str)` | Mark task as done (fuzzy match) |
| `set_intention` | `(title: str, evidence?: str, priority?: str, deadline?: str)` | Track ongoing goal across sessions |
| `complete_goal` | `(title: str)` | Mark intention as done |
| `note_to_self` | `(key: str, value: str, note_type?: str)` | Session-scoped scratch note (not permanent) |
| `dismiss_note` | `(key: str)` | Remove a session note |
| `update_human_memory` | `(content: str)` | Rewrite holistic user understanding (human core block) |
| `current_datetime` | `()` | UTC timestamp |

## Tool Organization

```python
def get_tools() -> list[Any]:
    """Return all tools available to the agent (core + extensions)."""
    tools = get_core_tools() + get_extension_tools()
    inject_inner_thoughts_into_tools(tools)
    inject_heartbeat_into_tools(tools)
    return tools
```

`get_core_tools()` and `get_extension_tools()` are separate functions, enabling a future OpenClaw-style pattern where the tool set can be configured per-user or per-session.

## Tool Orchestration Rules

Defined in `services/agent/rules.py` via `ToolRulesSolver`:

- `send_message` ends the turn (terminal tool) -- the only default rule
- No `InitToolRule` -- the model can call any tool at step 0
- Maximum 6 steps per turn (`agent_max_steps` setting)
- Loop continues only on `request_heartbeat=true` or tool error
- If max steps reached without `send_message`, the runtime forces a final response

## Cognitive Loop

The system prompt instructs a 2-step cognitive pattern:

```
1. ACT: Call tools as needed -- every tool call includes a `thinking` argument
   with your private reasoning. Set `request_heartbeat` to true when chaining tools.
2. RESPOND: Call send_message with your final reply (include `thinking`).
```

## Memory Tool Guidelines

The system prompt provides clear guidance on when to use which memory tool:

- **`core_memory_append/replace`**: For information that changes understanding (immediate, in-context). Labels: `human`, `persona`.
- **`save_to_memory`**: For discrete, searchable facts. Categories: `fact`, `preference`, `goal`, `relationship`. Importance 1-5.
- **`update_human_memory`**: For rewriting the entire user model. Use sparingly.
- **`note_to_self`**: For session-only scratch notes. Types: `observation`, `plan`, `context`, `emotion`.
- **`recall_memory`**: Hybrid search with pagination (5 results per page by default).
- **`recall_conversation`**: Search past exchanges by query, role, and date range.
