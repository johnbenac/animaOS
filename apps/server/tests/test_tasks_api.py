from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from anima_server.config import settings
from anima_server.db.base import Base
from anima_server.db.session import get_db
from anima_server.main import create_app
from anima_server.services.agent import invalidate_agent_runtime_cache
from anima_server.services.sessions import unlock_session_store


def _build_session_factory() -> tuple[Engine, sessionmaker]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    factory = sessionmaker(
        bind=engine,
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
        class_=Session,
    )
    return engine, factory


@contextmanager
def _client() -> Generator[TestClient, None, None]:
    engine, factory = _build_session_factory()
    Base.metadata.create_all(bind=engine)

    app = create_app()
    original_data_dir = settings.data_dir

    def override_get_db() -> Generator[Session, None, None]:
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    unlock_session_store.clear()
    invalidate_agent_runtime_cache()

    with TemporaryDirectory() as temp_dir:
        settings.data_dir = Path(temp_dir) / "anima-data"

        try:
            with TestClient(app) as test_client:
                yield test_client
        finally:
            import anima_server.services.agent.vector_store as _vs
            if _vs._client is not None:
                try:
                    _vs._client.clear_system_cache()
                except Exception:
                    pass
                _vs._client = None

            settings.data_dir = original_data_dir
            invalidate_agent_runtime_cache()
            unlock_session_store.clear()
            app.dependency_overrides.clear()
            Base.metadata.drop_all(bind=engine)
            engine.dispose()


def _register_user(client: TestClient) -> dict[str, object]:
    response = client.post(
        "/api/auth/register",
        json={"username": "tasktest", "password": "pw1234", "name": "Task Test"},
    )
    assert response.status_code == 201
    return response.json()


def test_tasks_crud_lifecycle() -> None:
    with _client() as client:
        reg = _register_user(client)
        user_id = reg["id"]
        headers = {"x-anima-unlock": reg["unlockToken"]}

        # List starts empty
        resp = client.get(f"/api/tasks?userId={user_id}", headers=headers)
        assert resp.status_code == 200
        assert resp.json() == []

        # Create a task
        resp = client.post(
            "/api/tasks",
            headers=headers,
            json={"userId": user_id, "text": "Buy groceries", "priority": 3},
        )
        assert resp.status_code == 201
        task = resp.json()
        assert task["text"] == "Buy groceries"
        assert task["priority"] == 3
        assert task["done"] is False
        task_id = task["id"]

        # Update task
        resp = client.put(
            f"/api/tasks/{task_id}",
            headers=headers,
            json={"done": True},
        )
        assert resp.status_code == 200
        updated = resp.json()
        assert updated["done"] is True
        assert updated["completedAt"] is not None

        # Delete task
        resp = client.delete(f"/api/tasks/{task_id}", headers=headers)
        assert resp.status_code == 200

        resp = client.get(f"/api/tasks?userId={user_id}", headers=headers)
        assert resp.json() == []


def test_tasks_require_auth() -> None:
    with _client() as client:
        resp = client.get("/api/tasks?userId=1")
        assert resp.status_code == 401
