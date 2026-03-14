from __future__ import annotations

import shutil
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path

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
from anima_server.services.agent.vector_store import reset_vector_store
from anima_server.services.sessions import unlock_session_store
from conftest import create_managed_temp_dir


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
    temp_root = create_managed_temp_dir("anima-memory-test-")

    def override_get_db() -> Generator[Session, None, None]:
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    unlock_session_store.clear()
    invalidate_agent_runtime_cache()
    settings.data_dir = temp_root / "anima-data"

    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        reset_vector_store()
        settings.data_dir = original_data_dir
        invalidate_agent_runtime_cache()
        unlock_session_store.clear()
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()
        shutil.rmtree(temp_root, ignore_errors=True)


def _register_user(client: TestClient) -> dict[str, object]:
    response = client.post(
        "/api/auth/register",
        json={"username": "memtest", "password": "pw1234", "name": "Mem Test"},
    )
    assert response.status_code == 201
    return response.json()


def test_memory_crud_lifecycle() -> None:
    with _client() as client:
        reg = _register_user(client)
        user_id = reg["id"]
        token = reg["unlockToken"]
        headers = {"x-anima-unlock": token}

        # Overview starts empty
        resp = client.get(f"/api/memory/{user_id}", headers=headers)
        assert resp.status_code == 200
        overview = resp.json()
        assert overview["totalItems"] == 0
        assert overview["currentFocus"] is None

        # Create a fact
        resp = client.post(
            f"/api/memory/{user_id}/items",
            headers=headers,
            json={"content": "Works as a designer", "category": "fact", "importance": 4},
        )
        assert resp.status_code == 201
        item = resp.json()
        assert item["content"] == "Works as a designer"
        assert item["category"] == "fact"
        assert item["importance"] == 4
        assert item["source"] == "user"
        item_id = item["id"]

        # Create a preference
        resp = client.post(
            f"/api/memory/{user_id}/items",
            headers=headers,
            json={"content": "Likes dark mode", "category": "preference"},
        )
        assert resp.status_code == 201

        # Overview reflects items
        resp = client.get(f"/api/memory/{user_id}", headers=headers)
        overview = resp.json()
        assert overview["totalItems"] == 2
        assert overview["factCount"] == 1
        assert overview["preferenceCount"] == 1

        # List items by category
        resp = client.get(f"/api/memory/{user_id}/items?category=fact", headers=headers)
        assert resp.status_code == 200
        facts = resp.json()
        assert len(facts) == 1
        assert facts[0]["content"] == "Works as a designer"

        # Update content (creates superseded chain)
        resp = client.put(
            f"/api/memory/{user_id}/items/{item_id}",
            headers=headers,
            json={"content": "Works as a product manager"},
        )
        assert resp.status_code == 200
        updated = resp.json()
        assert updated["content"] == "Works as a product manager"
        assert updated["id"] != item_id  # new item created

        # Old item should be superseded (not in active list)
        resp = client.get(f"/api/memory/{user_id}/items?category=fact", headers=headers)
        facts = resp.json()
        assert len(facts) == 1
        assert facts[0]["content"] == "Works as a product manager"

        # Delete
        resp = client.delete(
            f"/api/memory/{user_id}/items/{updated['id']}",
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["deleted"] is True

        resp = client.get(f"/api/memory/{user_id}/items?category=fact", headers=headers)
        assert len(resp.json()) == 0


def test_memory_duplicate_rejected() -> None:
    with _client() as client:
        reg = _register_user(client)
        user_id = reg["id"]
        headers = {"x-anima-unlock": reg["unlockToken"]}

        resp = client.post(
            f"/api/memory/{user_id}/items",
            headers=headers,
            json={"content": "Likes tea", "category": "preference"},
        )
        assert resp.status_code == 201

        resp = client.post(
            f"/api/memory/{user_id}/items",
            headers=headers,
            json={"content": "Likes tea", "category": "preference"},
        )
        assert resp.status_code == 409


def test_memory_requires_auth() -> None:
    with _client() as client:
        resp = client.get("/api/memory/1", headers={})
        assert resp.status_code == 401


def test_memory_episodes_empty() -> None:
    with _client() as client:
        reg = _register_user(client)
        user_id = reg["id"]
        headers = {"x-anima-unlock": reg["unlockToken"]}

        resp = client.get(f"/api/memory/{user_id}/episodes", headers=headers)
        assert resp.status_code == 200
        assert resp.json() == []
