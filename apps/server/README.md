# anima-server

FastAPI backend scaffold for the Python migration.

## Commands

```bash
uv sync --project apps/server
uv run --project apps/server uvicorn anima_server.main:app --app-dir apps/server/src --reload --host 127.0.0.1 --port 3031
uv run --project apps/server pytest
uv run --project apps/server ruff check src tests
```
