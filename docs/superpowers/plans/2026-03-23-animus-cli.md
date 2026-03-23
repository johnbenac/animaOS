# Animus CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI coding agent (`anima` command) that connects to the AnimaOS Python server via WebSocket, executing coding tools locally while the server handles the agent loop, memory, and LLM calls.

**Architecture:** Server-driven loop with client-side tool execution. The Python server runs the agent loop and delegates action tools (bash, file ops) to the CLI via WebSocket. The CLI executes tools locally and returns results. Split permission model: server handles cognitive tool safety, CLI handles filesystem safety.

**Tech Stack:** Python/FastAPI (server WebSocket), Bun/TypeScript/ink (CLI), ws (WebSocket client)

**Spec:** `docs/superpowers/specs/2026-03-23-animus-cli-design.md`

---

## File Structure

### Server-Side (Python)

| File | Responsibility |
|---|---|
| Create: `apps/server/src/anima_server/api/routes/ws.py` | WebSocket endpoint, auth, connection registry, message routing |
| Create: `apps/server/src/anima_server/services/agent/delegation.py` | Tool delegation logic — send tool_execute, await tool_result via asyncio.Future |
| Modify: `apps/server/src/anima_server/services/agent/runtime.py:100-124` | Add `tool_delegate` callback to AgentRuntime constructor and step execution |
| Modify: `apps/server/src/anima_server/services/agent/tools.py:871-890` | Add `build_action_tools_for_llm()` helper (per-turn, not global) |
| Modify: `apps/server/src/anima_server/services/agent/service.py` | Wire delegation callback when WebSocket client connected |
| Modify: `apps/server/src/anima_server/main.py:163-176` | Register WebSocket route |
| Create: `apps/server/tests/test_ws.py` | WebSocket endpoint tests |
| Create: `apps/server/tests/test_delegation.py` | Tool delegation tests |

### CLI-Side (TypeScript/Bun)

| File | Responsibility |
|---|---|
| Create: `apps/animus/package.json` | Package config, dependencies, bin entry |
| Create: `apps/animus/tsconfig.json` | TypeScript config |
| Create: `apps/animus/src/index.ts` | Entry point — parse args, launch TUI or headless |
| Create: `apps/animus/src/client/protocol.ts` | Message type definitions (shared types for all WS messages) |
| Create: `apps/animus/src/client/auth.ts` | Login flow, token read/write from ~/.animus/config.json |
| Create: `apps/animus/src/client/connection.ts` | WebSocket manager — connect, reconnect, heartbeat, message dispatch |
| Create: `apps/animus/src/tools/registry.ts` | Tool schema definitions, register with server |
| Create: `apps/animus/src/tools/executor.ts` | Dispatch incoming tool_execute to correct tool impl |
| Create: `apps/animus/src/tools/permissions.ts` | CLI-side permission checks (read-only auto-allow, write/bash ask) |
| Create: `apps/animus/src/tools/bash.ts` | Shell execution with streaming, abort, timeout |
| Create: `apps/animus/src/tools/read.ts` | Read file with line numbers |
| Create: `apps/animus/src/tools/write.ts` | Write/create file |
| Create: `apps/animus/src/tools/edit.ts` | Surgical edit (search/replace, line range) |
| Create: `apps/animus/src/tools/grep.ts` | Regex search across files |
| Create: `apps/animus/src/tools/glob.ts` | File pattern matching |
| Create: `apps/animus/src/tools/list_dir.ts` | Directory listing |
| Create: `apps/animus/src/tools/ask_user.ts` | Prompt user for input mid-turn |
| Create: `apps/animus/src/ui/App.tsx` | Root ink component — orchestrates all UI |
| Create: `apps/animus/src/ui/Header.tsx` | Status bar (model, connection status, cwd) |
| Create: `apps/animus/src/ui/Chat.tsx` | Message list rendering |
| Create: `apps/animus/src/ui/Input.tsx` | User text input with history |
| Create: `apps/animus/src/ui/ToolCall.tsx` | Tool call display (name, args, output) |
| Create: `apps/animus/src/ui/Approval.tsx` | Permission prompt (allow/deny/always) |
| Create: `apps/animus/src/ui/Spinner.tsx` | Thinking/loading indicator |

---

## Task 1: Server — WebSocket Endpoint & Connection Registry

**Files:**
- Create: `apps/server/src/anima_server/api/routes/ws.py`
- Modify: `apps/server/src/anima_server/main.py:163-176`
- Create: `apps/server/tests/test_ws.py`

This task creates the WebSocket endpoint that clients connect to. It handles authentication via unlockToken and maintains a registry of connected clients.

- [ ] **Step 1: Write test for WebSocket auth flow**

```python
# apps/server/tests/test_ws.py
import pytest
from conftest import managed_test_client


class TestWebSocketAuth:
    """Tests for WebSocket /ws/agent endpoint authentication."""

    def test_ws_auth_with_valid_token(self):
        """Client sends auth message with unlockToken, server responds auth_ok."""
        with managed_test_client() as (client, _, unlock_token, user_id):
            with client.websocket_connect("/ws/agent") as ws:
                ws.send_json({"type": "auth", "unlockToken": unlock_token})
                response = ws.receive_json()
                assert response["type"] == "auth_ok"
                assert "user" in response
                assert response["user"]["id"] == user_id

    def test_ws_auth_rejected_without_token(self):
        """Client that sends non-auth message first gets error."""
        with managed_test_client() as (client, _, unlock_token, user_id):
            with client.websocket_connect("/ws/agent") as ws:
                ws.send_json({"type": "user_message", "message": "hello"})
                response = ws.receive_json()
                assert response["type"] == "error"
                assert "auth" in response["message"].lower()

    def test_ws_tool_schemas_registration(self):
        """Client can register action tool schemas after auth."""
        with managed_test_client() as (client, _, unlock_token, user_id):
            with client.websocket_connect("/ws/agent") as ws:
                ws.send_json({"type": "auth", "unlockToken": unlock_token})
                auth_resp = ws.receive_json()
                assert auth_resp["type"] == "auth_ok"

                ws.send_json({"type": "tool_schemas", "tools": [
                    {"name": "bash", "description": "Run shell", "parameters": {}}
                ]})
                # No response expected — just verify no error
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/server && python -m pytest tests/test_ws.py -v`
Expected: FAIL — module not found

- [ ] **Step 3: Implement WebSocket endpoint**

```python
# apps/server/src/anima_server/api/routes/ws.py
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from anima_server.db.session import get_user_session_factory
from anima_server.db.user_store import authenticate_account
from anima_server.services.sessions import unlock_session_store

logger = logging.getLogger(__name__)

router = APIRouter()


@dataclass
class ClientConnection:
    """A connected WebSocket client."""
    websocket: WebSocket
    user_id: int
    username: str
    action_tool_schemas: list[dict[str, Any]] = field(default_factory=list)
    connected_at: float = 0.0
    _delegator: Any = field(default=None, repr=False)  # ToolDelegator, set per-turn


class ConnectionRegistry:
    """Tracks connected WebSocket clients per user."""

    def __init__(self) -> None:
        self._connections: dict[int, list[ClientConnection]] = {}

    def add(self, conn: ClientConnection) -> None:
        self._connections.setdefault(conn.user_id, []).append(conn)

    def remove(self, conn: ClientConnection) -> None:
        conns = self._connections.get(conn.user_id, [])
        if conn in conns:
            conns.remove(conn)
        if not conns:
            self._connections.pop(conn.user_id, None)

    def get_delegate(self, user_id: int, tool_name: str) -> ClientConnection | None:
        """Get the client that should execute a tool. Most recently connected wins."""
        conns = self._connections.get(user_id, [])
        for conn in reversed(conns):
            tool_names = [t.get("name", "") for t in conn.action_tool_schemas]
            if tool_name in tool_names:
                return conn
        return None

    def get_connections(self, user_id: int) -> list[ClientConnection]:
        return list(self._connections.get(user_id, []))

    def has_connections(self, user_id: int) -> bool:
        return bool(self._connections.get(user_id))

    def get_action_tool_schemas(self, user_id: int) -> list[dict[str, Any]]:
        """Get merged action tool schemas from all connections for a user."""
        seen: set[str] = set()
        schemas: list[dict[str, Any]] = []
        for conn in reversed(self._connections.get(user_id, [])):
            for schema in conn.action_tool_schemas:
                name = schema.get("name", "")
                if name not in seen:
                    seen.add(name)
                    schemas.append(schema)
        return schemas

    def get_action_tool_names(self, user_id: int) -> frozenset[str]:
        """Get names of all action tools registered by a user's connections."""
        return frozenset(s.get("name", "") for s in self.get_action_tool_schemas(user_id))


# Global singleton
registry = ConnectionRegistry()


async def _authenticate(ws: WebSocket) -> ClientConnection | None:
    """Wait for auth message, validate, return connection or None."""
    try:
        raw = await asyncio.wait_for(ws.receive_json(), timeout=10.0)
    except (asyncio.TimeoutError, WebSocketDisconnect):
        return None

    if raw.get("type") != "auth":
        await ws.send_json({"type": "error", "message": "Expected auth message first", "code": "AUTH_REQUIRED"})
        return None

    unlock_token = raw.get("unlockToken")
    username = raw.get("username")
    password = raw.get("password")

    # Try token-based auth first
    if unlock_token:
        session = unlock_session_store.resolve(unlock_token)
        if session is None:
            await ws.send_json({"type": "error", "message": "Invalid unlock token", "code": "AUTH_FAILED"})
            return None
        # Look up username from DB
        with get_user_session_factory(session.user_id)() as db:
            from anima_server.models import User
            user = db.get(User, session.user_id)
            resolved_username = user.username if user else (username or "")
        return ClientConnection(
            websocket=ws,
            user_id=session.user_id,
            username=resolved_username,
            connected_at=asyncio.get_event_loop().time(),
        )

    # Try username/password auth
    if username and password:
        try:
            response, deks = authenticate_account(username, password)
            user_id = int(response["id"])
            # Create an unlock session so future reconnects can use the token
            new_token = unlock_session_store.create(user_id, deks)
            return ClientConnection(
                websocket=ws,
                user_id=user_id,
                username=str(response.get("username", username)),
                connected_at=asyncio.get_event_loop().time(),
            )
        except ValueError:
            await ws.send_json({"type": "error", "message": "Invalid credentials", "code": "AUTH_FAILED"})
            return None

    await ws.send_json({"type": "error", "message": "Provide unlockToken or username/password", "code": "AUTH_REQUIRED"})
    return None


@router.websocket("/ws/agent")
async def ws_agent(websocket: WebSocket):
    await websocket.accept()
    conn = await _authenticate(websocket)
    if conn is None:
        await websocket.close(code=4001, reason="Authentication failed")
        return

    registry.add(conn)
    await websocket.send_json({
        "type": "auth_ok",
        "user": {"id": conn.user_id, "username": conn.username},
    })

    logger.info("WebSocket client connected: user_id=%d", conn.user_id)

    # Main message loop
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "tool_schemas":
                conn.action_tool_schemas = data.get("tools", [])
                logger.info("Client registered %d action tools", len(conn.action_tool_schemas))

            elif msg_type == "user_message":
                await _handle_user_message(conn, data)

            elif msg_type == "tool_result":
                _handle_tool_result(conn, data)

            elif msg_type == "approval_response":
                await _handle_approval_response(conn, data)

            elif msg_type == "cancel":
                await _handle_cancel(conn, data)

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected: user_id=%d", conn.user_id)
    finally:
        if conn._delegator:
            conn._delegator.cancel_all("Client disconnected")
        registry.remove(conn)


async def _handle_user_message(conn: ClientConnection, data: dict) -> None:
    """Handle incoming user message — run agent turn."""
    # Implemented in Task 3 when delegation is wired
    pass


def _handle_tool_result(conn: ClientConnection, data: dict) -> None:
    """Handle tool execution result from client."""
    # Implemented in Task 2 — delegation resolves pending futures
    pass


async def _handle_approval_response(conn: ClientConnection, data: dict) -> None:
    """Handle approval/denial of a cognitive tool."""
    pass


async def _handle_cancel(conn: ClientConnection, data: dict) -> None:
    """Handle turn cancellation request."""
    pass
```

- [ ] **Step 4: Register route in main.py**

Add to `apps/server/src/anima_server/main.py` after the other router imports:

```python
from anima_server.api.routes.ws import router as ws_router
```

And in the `create_app()` function after the other `app.include_router` calls:

```python
app.include_router(ws_router)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/server && python -m pytest tests/test_ws.py -v`
Expected: PASS (may need fixture adjustments for auth validation)

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/anima_server/api/routes/ws.py apps/server/src/anima_server/main.py apps/server/tests/test_ws.py
git commit -m "feat(server): add WebSocket endpoint with auth and connection registry"
```

---

## Task 2: Server — Tool Delegation

**Files:**
- Create: `apps/server/src/anima_server/services/agent/delegation.py`
- Create: `apps/server/tests/test_delegation.py`

This task creates the delegation mechanism: send a `tool_execute` message to a connected client, wait for the `tool_result` response, and return it to the agent loop.

- [ ] **Step 1: Write test for tool delegation**

```python
# apps/server/tests/test_delegation.py
import asyncio
import pytest
from anima_server.services.agent.delegation import ToolDelegator, DelegationTimeout

@pytest.mark.asyncio
async def test_delegate_resolves_on_result():
    """Delegator sends tool_execute and resolves when tool_result arrives."""
    sent_messages = []
    async def mock_send(msg):
        sent_messages.append(msg)

    delegator = ToolDelegator(send_fn=mock_send)

    # Start delegation in background
    task = asyncio.create_task(
        delegator.delegate("tc_1", "bash", {"command": "ls"})
    )
    await asyncio.sleep(0.01)  # Let it send

    assert len(sent_messages) == 1
    assert sent_messages[0]["type"] == "tool_execute"
    assert sent_messages[0]["tool_name"] == "bash"

    # Resolve it
    delegator.resolve("tc_1", {"status": "success", "result": "file1.txt\nfile2.txt"})
    result = await task

    assert result.output == "file1.txt\nfile2.txt"
    assert not result.is_error

@pytest.mark.asyncio
async def test_delegate_timeout():
    """Delegation times out if no result arrives."""
    async def mock_send(msg):
        pass

    delegator = ToolDelegator(send_fn=mock_send, timeout=0.05)

    with pytest.raises(DelegationTimeout):
        await delegator.delegate("tc_2", "bash", {"command": "sleep 999"})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/server && python -m pytest tests/test_delegation.py -v`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ToolDelegator**

```python
# apps/server/src/anima_server/services/agent/delegation.py
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Callable, Awaitable

logger = logging.getLogger(__name__)


class DelegationTimeout(Exception):
    """Raised when a delegated tool call times out."""
    pass


@dataclass
class DelegatedToolResult:
    """Result from a client-side tool execution."""
    call_id: str
    name: str
    output: str
    is_error: bool = False
    stdout: list[str] | None = None
    stderr: list[str] | None = None


class ToolDelegator:
    """Delegates tool execution to a connected WebSocket client."""

    def __init__(
        self,
        send_fn: Callable[[dict[str, Any]], Awaitable[None]],
        timeout: float = 300.0,
    ) -> None:
        self._send = send_fn
        self._timeout = timeout
        self._pending: dict[str, asyncio.Future[DelegatedToolResult]] = {}

    async def delegate(
        self,
        tool_call_id: str,
        tool_name: str,
        args: dict[str, Any],
    ) -> DelegatedToolResult:
        """Send tool_execute to client and wait for tool_result."""
        future: asyncio.Future[DelegatedToolResult] = asyncio.get_event_loop().create_future()
        self._pending[tool_call_id] = future

        await self._send({
            "type": "tool_execute",
            "tool_call_id": tool_call_id,
            "tool_name": tool_name,
            "args": args,
        })

        try:
            return await asyncio.wait_for(future, timeout=self._timeout)
        except asyncio.TimeoutError:
            self._pending.pop(tool_call_id, None)
            raise DelegationTimeout(
                f"Tool {tool_name} (call_id={tool_call_id}) timed out after {self._timeout}s"
            )

    def resolve(self, tool_call_id: str, data: dict[str, Any]) -> None:
        """Resolve a pending delegation with the client's result."""
        future = self._pending.pop(tool_call_id, None)
        if future is None:
            logger.warning("Received tool_result for unknown call_id: %s", tool_call_id)
            return
        if future.done():
            return

        is_error = data.get("status") == "error"
        result = DelegatedToolResult(
            call_id=tool_call_id,
            name=data.get("tool_name", ""),
            output=data.get("result", ""),
            is_error=is_error,
            stdout=data.get("stdout"),
            stderr=data.get("stderr"),
        )
        future.set_result(result)

    def cancel_all(self, reason: str = "Connection lost") -> None:
        """Cancel all pending delegations."""
        for call_id, future in self._pending.items():
            if not future.done():
                future.set_exception(DelegationTimeout(reason))
        self._pending.clear()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/server && python -m pytest tests/test_delegation.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/anima_server/services/agent/delegation.py apps/server/tests/test_delegation.py
git commit -m "feat(server): add ToolDelegator for client-side tool execution"
```

---

## Task 3: Server — Wire Delegation into Agent Runtime

**Files:**
- Modify: `apps/server/src/anima_server/services/agent/runtime.py:100-124`
- Modify: `apps/server/src/anima_server/services/agent/executor.py:58-82`
- Modify: `apps/server/src/anima_server/services/agent/tools.py:871-890`
- Modify: `apps/server/src/anima_server/api/routes/ws.py`
- Modify: `apps/server/src/anima_server/services/agent/service.py`

This task wires tool delegation into the existing agent loop. When a WebSocket client is connected and registers action tools, the runtime delegates those tool calls instead of executing them server-side.

- [ ] **Step 1: Add tool_delegate to AgentRuntime constructor**

In `apps/server/src/anima_server/services/agent/runtime.py`, modify `AgentRuntime.__init__` to accept an optional `tool_delegate` callback:

```python
def __init__(
    self,
    *,
    adapter: BaseLLMAdapter,
    tools: Sequence[Any] = (),
    tool_rules: Sequence[ToolRule] = (),
    persona_template: str = "default",
    tool_summaries: Sequence[str] = (),
    tool_executor: ToolExecutor | None = None,
    max_steps: int = 4,
    tool_delegate: Callable[[str, str, dict[str, Any]], Awaitable[ToolExecutionResult]] | None = None,
    delegated_tool_names: frozenset[str] = frozenset(),
) -> None:
    # ... existing init ...
    self._tool_delegate = tool_delegate
    self._delegated_tool_names = delegated_tool_names
```

- [ ] **Step 2: Modify ToolExecutor.execute to support delegation**

In `apps/server/src/anima_server/services/agent/executor.py`, add delegation check. After `thinking` and `heartbeat` are unpacked (line ~82), before tool dispatch:

```python
# After unpack_inner_thoughts_from_kwargs and unpack_heartbeat_from_kwargs:
# Check if this tool should be delegated to a connected client
if self._tool_delegate and tool_call.name in self._delegated_tool_names:
    clean_args = dict(tool_call.arguments) if tool_call.arguments else {}
    delegated_result = await self._tool_delegate(tool_call.id, tool_call.name, clean_args)
    return ToolExecutionResult(
        call_id=tool_call.id,
        name=tool_call.name,
        output=delegated_result.output,
        is_error=delegated_result.is_error,
        inner_thinking=thinking,
        request_heartbeat=heartbeat,
    )
```

Note: The delegation approach should be on ToolExecutor, not AgentRuntime, since ToolExecutor is where `thinking`/`heartbeat` are already stripped. Add `tool_delegate` and `delegated_tool_names` to ToolExecutor constructor.

- [ ] **Step 3: Pass action tool schemas per-turn via ConnectionRegistry**

The `ConnectionRegistry` (from Task 1) already stores action tool schemas per-connection. No module-level global state needed — the WebSocket handler passes schemas to the runtime per-turn.

In `apps/server/src/anima_server/services/agent/tools.py`, add a function that accepts schemas as a parameter (not global state):

```python
def build_action_tools_for_llm(action_tool_schemas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert client-registered action tool schemas into LLM tool format.
    Called per-turn with schemas from the connected client's registration."""
    return action_tool_schemas  # Already in OpenAI-compatible format from CLI
```

- [ ] **Step 4: Update stream_agent/run_agent to accept tool delegation**

Modify `apps/server/src/anima_server/services/agent/service.py` to accept optional delegation parameters. Add to both `stream_agent` and `run_agent`:

```python
async def stream_agent(
    user_message: str,
    user_id: int,
    db: Session,
    *,
    tool_delegate: Callable | None = None,
    delegated_tool_names: frozenset[str] = frozenset(),
    extra_tool_schemas: list[dict[str, Any]] | None = None,
) -> AsyncGenerator[AgentStreamEvent, None]:
```

Thread these through to `_build_runtime()` and `ToolExecutor`. When `tool_delegate` is provided, the executor delegates matching tools to the client instead of executing them server-side.

- [ ] **Step 5: Wire delegation in ws.py message handlers**

Update `_handle_user_message` in `apps/server/src/anima_server/api/routes/ws.py` to run the agent with delegation:

```python
async def _handle_user_message(conn: ClientConnection, data: dict) -> None:
    """Handle incoming user message — run agent turn with tool delegation."""
    from anima_server.services.agent.delegation import ToolDelegator
    from anima_server.services.agent import stream_agent
    from anima_server.db.session import get_user_session_factory

    message = data.get("message", "")

    delegator = ToolDelegator(
        send_fn=lambda msg: conn.websocket.send_json(msg)
    )
    conn._delegator = delegator

    action_tool_names = registry.get_action_tool_names(conn.user_id)
    action_tool_schemas = registry.get_action_tool_schemas(conn.user_id)

    with get_user_session_factory(conn.user_id)() as db:
        try:
            async for event in stream_agent(
                message,
                conn.user_id,
                db,
                tool_delegate=delegator.delegate,
                delegated_tool_names=action_tool_names,
                extra_tool_schemas=action_tool_schemas,
            ):
                if event.event == "thought":
                    continue
                await conn.websocket.send_json({
                    "type": event.event,
                    "data": event.data,
                })
        except Exception as exc:
            await conn.websocket.send_json({
                "type": "error",
                "message": str(exc),
                "code": "AGENT_ERROR",
            })
        finally:
            conn._delegator = None


def _handle_tool_result(conn: ClientConnection, data: dict) -> None:
    """Handle tool execution result from client."""
    if conn._delegator:
        conn._delegator.resolve(data.get("tool_call_id", ""), data)
```

- [ ] **Step 6: Run existing test suite to verify no regressions**

Run: `cd apps/server && python -m pytest tests/ -v --timeout=30`
Expected: All existing tests PASS (delegation is opt-in, None by default)

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/anima_server/services/agent/runtime.py \
    apps/server/src/anima_server/services/agent/executor.py \
    apps/server/src/anima_server/services/agent/tools.py \
    apps/server/src/anima_server/services/agent/service.py \
    apps/server/src/anima_server/api/routes/ws.py
git commit -m "feat(server): wire tool delegation into agent runtime"
```

> **Note:** Steps 4 and 5 have a circular dependency — Step 4 modifies `service.py` to accept delegation params, and Step 5 uses those params in `ws.py`. Implement Steps 4 and 5 together before testing.

---

## Task 4: CLI — Package Setup & Protocol Types

**Files:**
- Create: `apps/animus/package.json`
- Create: `apps/animus/tsconfig.json`
- Create: `apps/animus/src/client/protocol.ts`

Bootstrap the Animus CLI package and define all WebSocket message types.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "animus",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "anima": "./src/index.ts"
  },
  "scripts": {
    "dev": "bun run src/index.ts",
    "test": "bun test",
    "build": "bun build src/index.ts --outdir dist --target node"
  },
  "dependencies": {
    "ink": "^5.0.0",
    "ink-spinner": "^5.0.0",
    "ink-text-input": "^5.0.0",
    "react": "^18.2.0",
    "ws": "^8.19.0"
  },
  "devDependencies": {
    "@types/bun": "^1.3.7",
    "@types/react": "^19.2.9",
    "@types/ws": "^8.18.1",
    "typescript": "^5.9.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["bun-types"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Define protocol types**

```typescript
// apps/animus/src/client/protocol.ts

// ── Server -> Client ──

export interface AuthOkMessage {
  type: "auth_ok";
  user: { id: number; username: string };
}

export interface ToolExecuteMessage {
  type: "tool_execute";
  tool_call_id: string;
  tool_name: string;
  args: Record<string, unknown>;
}

export interface AssistantMessage {
  type: "assistant_message";
  content: string;
  partial: boolean;
}

export interface ReasoningMessage {
  type: "reasoning";
  content: string;
}

export interface ToolCallMessage {
  type: "tool_call";
  tool_call_id: string;
  tool_name: string;
  args: Record<string, unknown>;
}

export interface ToolReturnMessage {
  type: "tool_return";
  tool_call_id: string;
  tool_name: string;
  result: string;
}

export interface ApprovalRequiredMessage {
  type: "approval_required";
  tool_call_id: string;
  tool_name: string;
  args: Record<string, unknown>;
  run_id: number;
}

export interface TurnCompleteMessage {
  type: "turn_complete";
  response: string;
  model: string;
  provider: string;
  tools_used: string[];
}

export interface ErrorMessage {
  type: "error";
  message: string;
  code: string;
}

export interface StreamTokenMessage {
  type: "stream_token";
  token: string;
}

export type ServerMessage =
  | AuthOkMessage
  | ToolExecuteMessage
  | AssistantMessage
  | ReasoningMessage
  | ToolCallMessage
  | ToolReturnMessage
  | ApprovalRequiredMessage
  | TurnCompleteMessage
  | ErrorMessage
  | StreamTokenMessage;

// ── Client -> Server ──

export interface AuthMessage {
  type: "auth";
  unlockToken?: string;
  username?: string;
  password?: string;
}

export interface UserMessage {
  type: "user_message";
  message: string;
}

export interface ToolResultMessage {
  type: "tool_result";
  tool_call_id: string;
  status: "success" | "error";
  result: string;
  stdout?: string[];
  stderr?: string[];
}

export interface ToolSchemasMessage {
  type: "tool_schemas";
  tools: ToolSchema[];
}

export interface ApprovalResponseMessage {
  type: "approval_response";
  run_id: number;
  tool_call_id: string;
  approved: boolean;
  reason?: string;
}

export interface CancelMessage {
  type: "cancel";
  run_id?: number;
}

export type ClientMessage =
  | AuthMessage
  | UserMessage
  | ToolResultMessage
  | ToolSchemasMessage
  | ApprovalResponseMessage
  | CancelMessage;

// ── Tool Schema ──

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
```

- [ ] **Step 4: Install dependencies**

Run: `cd apps/animus && bun install`
Expected: node_modules created

- [ ] **Step 5: Commit**

```bash
git add apps/animus/
git commit -m "feat(animus): bootstrap CLI package with protocol types"
```

---

## Task 5: CLI — Auth & Config

**Files:**
- Create: `apps/animus/src/client/auth.ts`

Handles reading/writing `~/.animus/config.json`, login flow, and token management.

- [ ] **Step 1: Write test for config read/write**

```typescript
// apps/animus/src/client/auth.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { readConfig, writeConfig, type AnimusConfig } from "./auth";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("auth config", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "animus-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("readConfig returns null when no config exists", () => {
    const config = readConfig(join(tempDir, "config.json"));
    expect(config).toBeNull();
  });

  test("writeConfig creates file and readConfig reads it back", () => {
    const path = join(tempDir, "config.json");
    const config: AnimusConfig = {
      serverUrl: "ws://localhost:3031",
      unlockToken: "test_token",
      username: "leo",
    };
    writeConfig(path, config);
    const read = readConfig(path);
    expect(read).toEqual(config);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/animus && bun test src/client/auth.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement auth module**

```typescript
// apps/animus/src/client/auth.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export interface AnimusConfig {
  serverUrl: string;
  unlockToken: string;
  username: string;
}

const DEFAULT_CONFIG_PATH = join(homedir(), ".animus", "config.json");

export function getConfigPath(): string {
  return DEFAULT_CONFIG_PATH;
}

export function readConfig(path: string = DEFAULT_CONFIG_PATH): AnimusConfig | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as AnimusConfig;
  } catch {
    return null;
  }
}

export function writeConfig(path: string = DEFAULT_CONFIG_PATH, config: AnimusConfig): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
}

export async function login(serverUrl: string, username: string, password: string): Promise<AnimusConfig> {
  const httpUrl = serverUrl.replace(/^ws/, "http").replace(/\/ws\/agent$/, "");
  const res = await fetch(`${httpUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Login failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { unlockToken: string; username: string };
  return {
    serverUrl,
    unlockToken: data.unlockToken,
    username: data.username,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/animus && bun test src/client/auth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/animus/src/client/auth.ts apps/animus/src/client/auth.test.ts
git commit -m "feat(animus): add auth config read/write and login flow"
```

---

## Task 6: CLI — WebSocket Connection Manager

**Files:**
- Create: `apps/animus/src/client/connection.ts`

Manages the WebSocket lifecycle: connect, authenticate, register tools, dispatch messages, reconnect on disconnect.

- [ ] **Step 1: Implement connection manager**

```typescript
// apps/animus/src/client/connection.ts
import WebSocket from "ws";
import type {
  AuthMessage,
  ClientMessage,
  ServerMessage,
  ToolSchema,
} from "./protocol";
import type { AnimusConfig } from "./auth";

export type ConnectionStatus = "disconnected" | "connecting" | "authenticating" | "connected";

export interface ConnectionEvents {
  onStatusChange: (status: ConnectionStatus) => void;
  onMessage: (message: ServerMessage) => void;
  onError: (error: Error) => void;
}

export class ConnectionManager {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = "disconnected";
  private config: AnimusConfig;
  private events: ConnectionEvents;
  private toolSchemas: ToolSchema[];
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionallyClosed = false;

  constructor(config: AnimusConfig, toolSchemas: ToolSchema[], events: ConnectionEvents) {
    this.config = config;
    this.toolSchemas = toolSchemas;
    this.events = events;
  }

  connect(): void {
    this.intentionallyClosed = false;
    this.setStatus("connecting");

    const wsUrl = this.config.serverUrl.endsWith("/ws/agent")
      ? this.config.serverUrl
      : `${this.config.serverUrl}/ws/agent`;

    this.ws = new WebSocket(wsUrl);

    this.ws.on("open", () => {
      this.setStatus("authenticating");
      this.send({
        type: "auth",
        unlockToken: this.config.unlockToken,
        username: this.config.username,
      });
    });

    this.ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ServerMessage;

        if (msg.type === "auth_ok") {
          this.setStatus("connected");
          this.reconnectAttempt = 0;
          // Register tools
          this.send({ type: "tool_schemas", tools: this.toolSchemas });
        }

        this.events.onMessage(msg);
      } catch (err) {
        this.events.onError(new Error(`Failed to parse message: ${err}`));
      }
    });

    this.ws.on("close", () => {
      this.setStatus("disconnected");
      if (!this.intentionallyClosed) {
        this.scheduleReconnect();
      }
    });

    this.ws.on("error", (err) => {
      this.events.onError(err instanceof Error ? err : new Error(String(err)));
    });
  }

  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  disconnect(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.setStatus("disconnected");
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.events.onStatusChange(status);
  }

  private scheduleReconnect(): void {
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), 30000);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/animus/src/client/connection.ts
git commit -m "feat(animus): add WebSocket connection manager with reconnection"
```

---

## Task 7: CLI — Tool Implementations

**Files:**
- Create: `apps/animus/src/tools/registry.ts`
- Create: `apps/animus/src/tools/executor.ts`
- Create: `apps/animus/src/tools/permissions.ts`
- Create: `apps/animus/src/tools/bash.ts`
- Create: `apps/animus/src/tools/read.ts`
- Create: `apps/animus/src/tools/write.ts`
- Create: `apps/animus/src/tools/edit.ts`
- Create: `apps/animus/src/tools/grep.ts`
- Create: `apps/animus/src/tools/glob.ts`
- Create: `apps/animus/src/tools/list_dir.ts`
- Create: `apps/animus/src/tools/ask_user.ts`

Implement all 8 action tools with the executor and permission system. This is the largest task — each tool is a focused implementation.

- [ ] **Step 1: Write test for bash tool**

```typescript
// apps/animus/src/tools/bash.test.ts
import { describe, test, expect } from "bun:test";
import { executeBash } from "./bash";

describe("bash tool", () => {
  test("executes simple command and returns output", async () => {
    const result = await executeBash({ command: "echo hello" });
    expect(result.status).toBe("success");
    expect(result.result.trim()).toBe("hello");
  });

  test("returns error for failing command", async () => {
    const result = await executeBash({ command: "exit 1" });
    expect(result.status).toBe("error");
  });

  test("respects timeout", async () => {
    const result = await executeBash({ command: "sleep 10", timeout: 100 });
    expect(result.status).toBe("error");
    expect(result.result).toContain("timeout");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/animus && bun test src/tools/bash.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement bash tool**

```typescript
// apps/animus/src/tools/bash.ts
import { spawn } from "node:child_process";

export interface BashArgs {
  command: string;
  timeout?: number;
  cwd?: string;
}

export interface ToolResult {
  status: "success" | "error";
  result: string;
  stdout?: string[];
  stderr?: string[];
}

const MAX_OUTPUT_LINES = 500;

export async function executeBash(args: BashArgs): Promise<ToolResult> {
  const { command, timeout = 120000, cwd = process.cwd() } = args;
  const stdout: string[] = [];
  const stderr: string[] = [];

  return new Promise<ToolResult>((resolve) => {
    const proc = spawn("bash", ["-c", command], {
      cwd,
      env: { ...process.env },
      timeout,
    });

    proc.stdout?.on("data", (data: Buffer) => {
      stdout.push(data.toString());
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderr.push(data.toString());
    });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      const msg = err.code === "ETIMEDOUT" || err.message.includes("timed out")
        ? `Command timed out after ${timeout}ms`
        : err.message;
      resolve({ status: "error", result: msg, stdout, stderr });
    });

    proc.on("close", (code) => {
      let output = stdout.join("");
      const lines = output.split("\n");
      if (lines.length > MAX_OUTPUT_LINES) {
        output = `[...truncated ${lines.length - MAX_OUTPUT_LINES} lines...]\n${lines.slice(-MAX_OUTPUT_LINES).join("\n")}`;
      }

      resolve({
        status: code === 0 ? "success" : "error",
        result: output || stderr.join(""),
        stdout,
        stderr,
      });
    });
  });
}
```

- [ ] **Step 4: Run bash test to verify it passes**

Run: `cd apps/animus && bun test src/tools/bash.test.ts`
Expected: PASS

- [ ] **Step 5: Implement remaining tools**

Create each tool file. Each follows the same pattern: takes args, returns `ToolResult`.

```typescript
// apps/animus/src/tools/read.ts
import { readFileSync, existsSync } from "node:fs";

export interface ReadArgs {
  file_path: string;
  offset?: number;
  limit?: number;
}

export function executeRead(args: ReadArgs): { status: "success" | "error"; result: string } {
  const { file_path, offset = 0, limit = 2000 } = args;
  if (!existsSync(file_path)) {
    return { status: "error", result: `File not found: ${file_path}` };
  }
  const content = readFileSync(file_path, "utf-8");
  const lines = content.split("\n");
  const sliced = lines.slice(offset, offset + limit);
  const numbered = sliced.map((line, i) => `${String(offset + i + 1).padStart(6)}| ${line}`);
  return { status: "success", result: numbered.join("\n") };
}
```

```typescript
// apps/animus/src/tools/write.ts
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export interface WriteArgs {
  file_path: string;
  content: string;
}

export function executeWrite(args: WriteArgs): { status: "success" | "error"; result: string } {
  const { file_path, content } = args;
  const dir = dirname(file_path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(file_path, content, "utf-8");
  return { status: "success", result: `Wrote ${content.length} chars to ${file_path}` };
}
```

```typescript
// apps/animus/src/tools/edit.ts
import { readFileSync, writeFileSync, existsSync } from "node:fs";

export interface EditArgs {
  file_path: string;
  old_string: string;
  new_string: string;
}

export function executeEdit(args: EditArgs): { status: "success" | "error"; result: string } {
  const { file_path, old_string, new_string } = args;
  if (!existsSync(file_path)) {
    return { status: "error", result: `File not found: ${file_path}` };
  }
  const content = readFileSync(file_path, "utf-8");
  if (!content.includes(old_string)) {
    return { status: "error", result: `old_string not found in ${file_path}` };
  }
  const updated = content.replace(old_string, new_string);
  writeFileSync(file_path, updated, "utf-8");
  return { status: "success", result: `Edited ${file_path}` };
}
```

```typescript
// apps/animus/src/tools/grep.ts
import { execSync } from "node:child_process";

export interface GrepArgs {
  pattern: string;
  path?: string;
  include?: string;
}

export function executeGrep(args: GrepArgs): { status: "success" | "error"; result: string } {
  const { pattern, path = ".", include } = args;
  try {
    const globFlag = include ? `--glob '${include}'` : "";
    const output = execSync(
      `rg --line-number --no-heading ${globFlag} '${pattern}' '${path}'`,
      { encoding: "utf-8", maxBuffer: 1024 * 1024, timeout: 30000 }
    );
    return { status: "success", result: output.slice(0, 50000) };
  } catch (err: any) {
    if (err.status === 1) return { status: "success", result: "No matches found" };
    return { status: "error", result: err.message };
  }
}
```

```typescript
// apps/animus/src/tools/glob.ts
import { Glob } from "bun";

export interface GlobArgs {
  pattern: string;
  path?: string;
}

export function executeGlob(args: GlobArgs): { status: "success" | "error"; result: string } {
  const { pattern, path = "." } = args;
  const glob = new Glob(pattern);
  const matches = [...glob.scanSync({ cwd: path })];
  if (matches.length === 0) {
    return { status: "success", result: "No files found" };
  }
  return { status: "success", result: matches.join("\n") };
}
```

```typescript
// apps/animus/src/tools/list_dir.ts
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface ListDirArgs {
  path: string;
}

export function executeListDir(args: ListDirArgs): { status: "success" | "error"; result: string } {
  const { path } = args;
  if (!existsSync(path)) {
    return { status: "error", result: `Directory not found: ${path}` };
  }
  const entries = readdirSync(path);
  const lines = entries.map((name) => {
    const stat = statSync(join(path, name));
    const prefix = stat.isDirectory() ? "[dir]  " : "[file] ";
    return `${prefix}${name}`;
  });
  return { status: "success", result: lines.join("\n") };
}
```

```typescript
// apps/animus/src/tools/ask_user.ts

// ask_user is special — it's handled by the UI layer, not executed here.
// The executor will emit an event that the TUI picks up to show a prompt.
export interface AskUserArgs {
  question: string;
}

// Placeholder — actual implementation is in the UI layer
export async function executeAskUser(_args: AskUserArgs): Promise<{ status: "success" | "error"; result: string }> {
  // This will be replaced by UI integration in Task 9
  return { status: "error", result: "ask_user not available in headless mode" };
}
```

- [ ] **Step 6: Implement tool registry and executor**

```typescript
// apps/animus/src/tools/registry.ts
import type { ToolSchema } from "../client/protocol";

export const ACTION_TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: "bash",
    description: "Execute a shell command and return its output.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The bash command to execute" },
        timeout: { type: "number", description: "Timeout in milliseconds (default: 120000)" },
      },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description: "Read a file and return its contents with line numbers.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute path to the file" },
        offset: { type: "number", description: "Line offset to start reading from" },
        limit: { type: "number", description: "Max lines to read (default: 2000)" },
      },
      required: ["file_path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file, creating directories as needed.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute path to the file" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["file_path", "content"],
    },
  },
  {
    name: "edit_file",
    description: "Edit a file by replacing old_string with new_string.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute path to the file" },
        old_string: { type: "string", description: "Exact string to find and replace" },
        new_string: { type: "string", description: "Replacement string" },
      },
      required: ["file_path", "old_string", "new_string"],
    },
  },
  {
    name: "grep",
    description: "Search for a regex pattern across files.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern to search for" },
        path: { type: "string", description: "Directory to search in (default: cwd)" },
        include: { type: "string", description: "Glob to filter files (e.g. '*.ts')" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "glob",
    description: "Find files matching a glob pattern.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern (e.g. '**/*.ts')" },
        path: { type: "string", description: "Base directory (default: cwd)" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "list_dir",
    description: "List contents of a directory.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path to list" },
      },
      required: ["path"],
    },
  },
  {
    name: "ask_user",
    description: "Ask the user a question and wait for their response.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "Question to ask the user" },
      },
      required: ["question"],
    },
  },
];
```

```typescript
// apps/animus/src/tools/executor.ts
import type { ToolExecuteMessage } from "../client/protocol";
import { executeBash } from "./bash";
import { executeRead } from "./read";
import { executeWrite } from "./write";
import { executeEdit } from "./edit";
import { executeGrep } from "./grep";
import { executeGlob } from "./glob";
import { executeListDir } from "./list_dir";
import { executeAskUser } from "./ask_user";
import { checkPermission, type PermissionDecision } from "./permissions";

export interface ExecutionResult {
  tool_call_id: string;
  status: "success" | "error";
  result: string;
  stdout?: string[];
  stderr?: string[];
}

export type ApprovalCallback = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<PermissionDecision>;

export async function executeTool(
  msg: ToolExecuteMessage,
  onApproval?: ApprovalCallback,
): Promise<ExecutionResult> {
  const { tool_call_id, tool_name, args } = msg;

  // Check permissions
  const decision = checkPermission(tool_name, args);
  if (decision === "ask" && onApproval) {
    const userDecision = await onApproval(tool_name, args);
    if (userDecision === "deny") {
      return { tool_call_id, status: "error", result: "User denied tool execution" };
    }
  } else if (decision === "deny") {
    return { tool_call_id, status: "error", result: "Tool execution denied by permission policy" };
  }

  try {
    let result: { status: "success" | "error"; result: string; stdout?: string[]; stderr?: string[] };

    switch (tool_name) {
      case "bash":
        result = await executeBash(args as any);
        break;
      case "read_file":
        result = executeRead(args as any);
        break;
      case "write_file":
        result = executeWrite(args as any);
        break;
      case "edit_file":
        result = executeEdit(args as any);
        break;
      case "grep":
        result = executeGrep(args as any);
        break;
      case "glob":
        result = executeGlob(args as any);
        break;
      case "list_dir":
        result = executeListDir(args as any);
        break;
      case "ask_user":
        result = await executeAskUser(args as any);
        break;
      default:
        result = { status: "error", result: `Unknown tool: ${tool_name}` };
    }

    return { tool_call_id, ...result };
  } catch (err) {
    return {
      tool_call_id,
      status: "error",
      result: err instanceof Error ? err.message : String(err),
    };
  }
}
```

- [ ] **Step 7: Implement permissions**

```typescript
// apps/animus/src/tools/permissions.ts
import { resolve, relative } from "node:path";

export type PermissionDecision = "allow" | "deny" | "ask";

const READ_ONLY_TOOLS = new Set(["read_file", "grep", "glob", "list_dir"]);
const WRITE_TOOLS = new Set(["write_file", "edit_file"]);

const SAFE_BASH_PATTERNS = [
  /^(ls|pwd|echo|cat|head|tail|wc|date|whoami|which|type|file)\b/,
  /^git\s+(status|log|diff|branch|show|remote|tag)\b/,
  /^(node|python|bun|npm|pip)\s+--version$/,
];

const DANGEROUS_BASH_PATTERNS = [
  /^(rm|rmdir)\s/,
  /^sudo\b/,
  /^git\s+(push|reset|rebase|force)/,
  /^(chmod|chown)\s/,
  /\|\s*sh\b/,
  />\s*\/dev\/sd/,
];

// Session-scoped "always allow" rules
const sessionRules: Set<string> = new Set();

export function addSessionRule(rule: string): void {
  sessionRules.add(rule);
}

export function checkPermission(toolName: string, args: Record<string, unknown>): PermissionDecision {
  // ask_user is always allowed
  if (toolName === "ask_user") return "allow";

  // Read-only tools always allowed
  if (READ_ONLY_TOOLS.has(toolName)) return "allow";

  // Check session rules
  if (sessionRules.has(toolName)) return "allow";

  // Write tools: allow within cwd, ask outside
  if (WRITE_TOOLS.has(toolName)) {
    const filePath = args.file_path as string | undefined;
    if (filePath) {
      const rel = relative(process.cwd(), resolve(filePath));
      if (rel.startsWith("..")) return "ask";
    }
    return "allow";
  }

  // Bash: pattern matching
  if (toolName === "bash") {
    const command = (args.command as string || "").trim();

    // Check session rules for specific commands
    if (sessionRules.has(`bash:${command}`)) return "allow";

    // Safe commands
    if (SAFE_BASH_PATTERNS.some((p) => p.test(command))) return "allow";

    // Dangerous commands
    if (DANGEROUS_BASH_PATTERNS.some((p) => p.test(command))) return "ask";

    // Default: ask for unknown bash commands
    return "ask";
  }

  return "ask";
}
```

- [ ] **Step 8: Run all tool tests**

Run: `cd apps/animus && bun test src/tools/`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/animus/src/tools/
git commit -m "feat(animus): implement 8 action tools with executor and permissions"
```

---

## Task 8: CLI — TUI Components

**Files:**
- Create: `apps/animus/src/ui/App.tsx`
- Create: `apps/animus/src/ui/Header.tsx`
- Create: `apps/animus/src/ui/Chat.tsx`
- Create: `apps/animus/src/ui/Input.tsx`
- Create: `apps/animus/src/ui/ToolCall.tsx`
- Create: `apps/animus/src/ui/Approval.tsx`
- Create: `apps/animus/src/ui/Spinner.tsx`

Build the ink/React TUI. This is the user-facing interface.

- [ ] **Step 1: Implement Header component**

```tsx
// apps/animus/src/ui/Header.tsx
import React from "react";
import { Box, Text } from "ink";
import type { ConnectionStatus } from "../client/connection";

interface HeaderProps {
  connectionStatus: ConnectionStatus;
  model?: string;
  cwd: string;
}

const STATUS_COLORS: Record<ConnectionStatus, string> = {
  connected: "green",
  connecting: "yellow",
  authenticating: "yellow",
  disconnected: "red",
};

export function Header({ connectionStatus, model, cwd }: HeaderProps) {
  return (
    <Box borderStyle="single" paddingX={1} flexDirection="row" justifyContent="space-between">
      <Text bold>anima</Text>
      <Text>{model ?? "no model"}</Text>
      <Text color={STATUS_COLORS[connectionStatus]}>{connectionStatus}</Text>
      <Text dimColor>{cwd}</Text>
    </Box>
  );
}
```

- [ ] **Step 2: Implement Spinner component**

```tsx
// apps/animus/src/ui/Spinner.tsx
import React from "react";
import { Box, Text } from "ink";
import InkSpinner from "ink-spinner";

interface SpinnerProps {
  label?: string;
}

export function Spinner({ label = "Thinking..." }: SpinnerProps) {
  return (
    <Box>
      <Text color="cyan"><InkSpinner type="dots" /></Text>
      <Text> {label}</Text>
    </Box>
  );
}
```

- [ ] **Step 3: Implement ToolCall component**

```tsx
// apps/animus/src/ui/ToolCall.tsx
import React from "react";
import { Box, Text } from "ink";

interface ToolCallProps {
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
  status?: "running" | "success" | "error";
}

export function ToolCall({ toolName, args, result, status = "running" }: ToolCallProps) {
  const statusColor = status === "success" ? "green" : status === "error" ? "red" : "yellow";
  const argsPreview = Object.entries(args)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v.slice(0, 80) : JSON.stringify(v)}`)
    .join(", ");

  return (
    <Box flexDirection="column" marginY={0}>
      <Text>
        <Text color={statusColor}>{">"}</Text>
        <Text bold> {toolName}</Text>
        <Text dimColor>({argsPreview})</Text>
      </Text>
      {result && (
        <Box marginLeft={2}>
          <Text dimColor>{result.slice(0, 500)}{result.length > 500 ? "..." : ""}</Text>
        </Box>
      )}
    </Box>
  );
}
```

- [ ] **Step 4: Implement Approval component**

```tsx
// apps/animus/src/ui/Approval.tsx
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface ApprovalProps {
  toolName: string;
  args: Record<string, unknown>;
  onDecision: (decision: "allow" | "deny" | "always") => void;
}

export function Approval({ toolName, args, onDecision }: ApprovalProps) {
  const [selected, setSelected] = useState(0);
  const options = ["Allow", "Deny", "Always allow"];

  useInput((input, key) => {
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow) setSelected((s) => Math.min(options.length - 1, s + 1));
    if (key.return) {
      const decisions = ["allow", "deny", "always"] as const;
      onDecision(decisions[selected]);
    }
  });

  const preview = toolName === "bash" ? (args.command as string) : JSON.stringify(args).slice(0, 100);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text bold color="yellow">Permission required</Text>
      <Text><Text bold>{toolName}</Text>: {preview}</Text>
      <Box flexDirection="column" marginTop={1}>
        {options.map((opt, i) => (
          <Text key={opt}>
            {i === selected ? <Text color="cyan">{"> "}</Text> : "  "}
            {opt}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 5: Implement Chat component**

```tsx
// apps/animus/src/ui/Chat.tsx
import React from "react";
import { Box, Text } from "ink";
import { ToolCall } from "./ToolCall";

export interface ChatEntry {
  type: "user" | "assistant" | "tool_call" | "error";
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolStatus?: "running" | "success" | "error";
}

interface ChatProps {
  entries: ChatEntry[];
}

export function Chat({ entries }: ChatProps) {
  return (
    <Box flexDirection="column" flexGrow={1}>
      {entries.map((entry, i) => {
        switch (entry.type) {
          case "user":
            return (
              <Box key={i} marginY={0}>
                <Text bold color="blue">You: </Text>
                <Text>{entry.content}</Text>
              </Box>
            );
          case "assistant":
            return (
              <Box key={i} marginY={0}>
                <Text bold color="green">Anima: </Text>
                <Text>{entry.content}</Text>
              </Box>
            );
          case "tool_call":
            return (
              <ToolCall
                key={i}
                toolName={entry.toolName!}
                args={entry.toolArgs!}
                result={entry.content}
                status={entry.toolStatus}
              />
            );
          case "error":
            return (
              <Box key={i}>
                <Text color="red">Error: {entry.content}</Text>
              </Box>
            );
          default:
            return null;
        }
      })}
    </Box>
  );
}
```

- [ ] **Step 6: Implement Input component**

```tsx
// apps/animus/src/ui/Input.tsx
import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

interface InputProps {
  onSubmit: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function Input({ onSubmit, disabled = false, placeholder = "Type a message..." }: InputProps) {
  const [value, setValue] = useState("");

  const handleSubmit = (text: string) => {
    if (text.trim() && !disabled) {
      onSubmit(text.trim());
      setValue("");
    }
  };

  return (
    <Box>
      <Text bold color="blue">{"> "}</Text>
      {disabled ? (
        <Text dimColor>{placeholder}</Text>
      ) : (
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder={placeholder}
        />
      )}
    </Box>
  );
}
```

- [ ] **Step 7: Implement App root component**

```tsx
// apps/animus/src/ui/App.tsx
import React, { useState, useCallback, useEffect } from "react";
import { Box, useApp } from "ink";
import { Header } from "./Header";
import { Chat, type ChatEntry } from "./Chat";
import { Input } from "./Input";
import { Spinner } from "./Spinner";
import { Approval } from "./Approval";
import { ConnectionManager, type ConnectionStatus } from "../client/connection";
import { executeTool } from "../tools/executor";
import { addSessionRule, type PermissionDecision } from "../tools/permissions";
import { ACTION_TOOL_SCHEMAS } from "../tools/registry";
import type { AnimusConfig } from "../client/auth";
import type { ServerMessage, ToolExecuteMessage } from "../client/protocol";

interface AppProps {
  config: AnimusConfig;
}

export function App({ config }: AppProps) {
  const { exit } = useApp();
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<ToolExecuteMessage | null>(null);
  const [approvalResolver, setApprovalResolver] = useState<((d: PermissionDecision) => void) | null>(null);
  const [connection, setConnection] = useState<ConnectionManager | null>(null);
  const [model, setModel] = useState<string | undefined>();

  const addEntry = useCallback((entry: ChatEntry) => {
    setEntries((prev) => [...prev, entry]);
  }, []);

  useEffect(() => {
    const conn = new ConnectionManager(config, ACTION_TOOL_SCHEMAS, {
      onStatusChange: setStatus,
      onError: (err) => addEntry({ type: "error", content: err.message }),
      onMessage: async (msg: ServerMessage) => {
        switch (msg.type) {
          case "assistant_message":
            if (!msg.partial) {
              addEntry({ type: "assistant", content: msg.content });
              setIsThinking(false);
            }
            break;
          case "tool_execute":
            addEntry({
              type: "tool_call",
              content: "",
              toolName: msg.tool_name,
              toolArgs: msg.args,
              toolStatus: "running",
            });
            const result = await executeTool(msg, async (toolName, args) => {
              return new Promise<PermissionDecision>((resolve) => {
                setPendingApproval(msg);
                setApprovalResolver(() => resolve);
              });
            });
            // Update tool call entry with result
            setEntries((prev) => {
              const updated = [...prev];
              const idx = updated.findLastIndex(
                (e) => e.type === "tool_call" && e.toolName === msg.tool_name && e.toolStatus === "running"
              );
              if (idx >= 0) {
                updated[idx] = { ...updated[idx], content: result.result, toolStatus: result.status };
              }
              return updated;
            });
            conn.send({ type: "tool_result", ...result });
            break;
          case "turn_complete":
            setIsThinking(false);
            setModel(msg.model);
            break;
          case "error":
            addEntry({ type: "error", content: msg.message });
            setIsThinking(false);
            break;
        }
      },
    });
    conn.connect();
    setConnection(conn);
    return () => conn.disconnect();
  }, [config, addEntry]);

  const handleSubmit = useCallback((text: string) => {
    if (text === "/quit" || text === "/exit") {
      exit();
      return;
    }
    if (text === "/clear") {
      setEntries([]);
      return;
    }
    addEntry({ type: "user", content: text });
    setIsThinking(true);
    connection?.send({ type: "user_message", message: text });
  }, [connection, addEntry, exit]);

  const handleApproval = useCallback((decision: "allow" | "deny" | "always") => {
    if (decision === "always" && pendingApproval) {
      addSessionRule(pendingApproval.tool_name);
    }
    approvalResolver?.(decision === "deny" ? "deny" : "allow");
    setPendingApproval(null);
    setApprovalResolver(null);
  }, [pendingApproval, approvalResolver]);

  return (
    <Box flexDirection="column" height="100%">
      <Header connectionStatus={status} model={model} cwd={process.cwd()} />
      <Chat entries={entries} />
      {isThinking && <Spinner />}
      {pendingApproval && (
        <Approval
          toolName={pendingApproval.tool_name}
          args={pendingApproval.args}
          onDecision={handleApproval}
        />
      )}
      <Input onSubmit={handleSubmit} disabled={isThinking || !!pendingApproval} />
    </Box>
  );
}
```

- [ ] **Step 8: Commit**

```bash
git add apps/animus/src/ui/
git commit -m "feat(animus): implement ink TUI components"
```

---

## Task 9: CLI — Entry Point

**Files:**
- Create: `apps/animus/src/index.ts`

Wire everything together: parse CLI args, handle login, launch TUI or headless mode.

- [ ] **Step 1: Implement entry point**

```typescript
#!/usr/bin/env bun
// apps/animus/src/index.ts
import { render } from "ink";
import React from "react";
import { App } from "./ui/App";
import { readConfig, writeConfig, login, getConfigPath } from "./client/auth";

const args = process.argv.slice(2);
const serverFlag = args.indexOf("--server");
const serverUrl = serverFlag >= 0 ? args[serverFlag + 1] : undefined;

async function main() {
  let config = readConfig();

  // Override server URL if provided
  if (serverUrl && config) {
    config = { ...config, serverUrl };
  }

  // If no config, prompt for login
  if (!config) {
    const url = serverUrl || "ws://localhost:3031";
    console.log(`Connecting to ${url}`);
    console.log("Login required.");

    const readline = await import("node:readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string): Promise<string> =>
      new Promise((resolve) => rl.question(q, resolve));

    const username = await ask("Username: ");
    const password = await ask("Password: ");
    rl.close();

    try {
      config = await login(url, username, password);
      writeConfig(getConfigPath(), config);
      console.log(`Logged in as ${config.username}. Config saved.`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  // Headless mode: first non-flag arg is the prompt
  const prompt = args.find((a) => !a.startsWith("--") && a !== serverUrl);
  if (prompt) {
    // TODO: headless mode — connect, send prompt, print result, exit
    console.log("Headless mode not yet implemented. Use interactive mode.");
    process.exit(0);
  }

  // Interactive TUI mode
  render(React.createElement(App, { config }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it launches**

Run: `cd apps/animus && bun run src/index.ts`
Expected: Shows login prompt (if no config) or connects to server

- [ ] **Step 3: Commit**

```bash
git add apps/animus/src/index.ts
git commit -m "feat(animus): add CLI entry point with login and TUI launch"
```

---

## Task 10: Integration — End-to-End Smoke Test

**Files:**
- No new files — manual verification

Verify the full flow: CLI connects to server, sends message, server runs agent loop, delegates bash tool to CLI, CLI executes and returns result, server completes turn.

- [ ] **Step 1: Start the Python server**

Run: `cd apps/server && python -m anima_server`
Expected: Server starts on port 3031

- [ ] **Step 2: Launch Animus CLI**

Run: `cd apps/animus && bun run src/index.ts`
Expected: Login prompt or TUI with "connected" status

- [ ] **Step 3: Send a test message**

Type: `list the files in the current directory`
Expected:
1. Server receives message, runs agent loop
2. LLM decides to call `bash` or `list_dir`
3. Server sends `tool_execute` to CLI
4. CLI executes tool locally, shows output in TUI
5. CLI sends `tool_result` back to server
6. Server continues loop, LLM generates response
7. Response appears in TUI

- [ ] **Step 4: Test permission prompt**

Type: `delete all .tmp files`
Expected: CLI shows approval prompt for the `rm` command, user can allow/deny

- [ ] **Step 5: Commit any fixes discovered during integration**

```bash
git add -A
git commit -m "fix(animus): integration fixes from smoke testing"
```

---

## Task 11: Polish & Documentation

**Files:**
- Modify: `apps/animus/package.json` (add to workspace)
- Modify: `package.json` (root workspace)
- Update: `DEVELOPER.md`

- [ ] **Step 1: Add animus to root workspace**

In root `package.json`, add `"apps/animus"` to the workspaces array.

- [ ] **Step 2: Update DEVELOPER.md**

Add section about Animus CLI: what it is, how to run it, how to develop it.

- [ ] **Step 3: Final commit**

```bash
git add package.json DEVELOPER.md apps/animus/package.json
git commit -m "docs: add Animus CLI to workspace and developer docs"
```
