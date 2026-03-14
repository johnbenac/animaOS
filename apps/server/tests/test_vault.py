from __future__ import annotations

import json
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from anima_server.db.base import Base
from anima_server.db.session import get_db
from anima_server.main import create_app
from anima_server.models import User, UserKey
from anima_server.services.auth import create_user
from anima_server.services.sessions import unlock_session_store
from anima_server.services.storage import get_user_data_dir

TEST_DEK = bytes(range(32))


@pytest.fixture()
def session_factory() -> Generator[sessionmaker, None, None]:
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
    Base.metadata.create_all(bind=engine)
    try:
        yield factory
    finally:
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


@pytest.fixture()
def client(session_factory: sessionmaker) -> Generator[TestClient, None, None]:
    app = create_app()

    def override_get_db() -> Generator[Session, None, None]:
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    unlock_session_store.clear()
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        unlock_session_store.clear()
        app.dependency_overrides.clear()


def seed_user(session_factory: sessionmaker) -> User:
    with session_factory() as db:
        user, _ = create_user(db, username="alice", password="pw123", display_name="Alice")
        return user


def test_export_vault_requires_unlock_session(client: TestClient) -> None:
    response = client.post("/api/vault/export", json={"passphrase": "vault-pass"})

    assert response.status_code == 401
    assert response.json() == {"error": "Session locked. Please sign in again."}


def test_export_and_import_vault_restores_auth_and_files(
    client: TestClient,
    session_factory: sessionmaker,
    managed_tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("anima_server.config.settings.data_dir", managed_tmp_path / "anima-data")
    user = seed_user(session_factory)
    token = unlock_session_store.create(user.id, TEST_DEK)
    user_dir = get_user_data_dir(user.id)
    user_dir.mkdir(parents=True, exist_ok=True)
    (user_dir / "memory" / "entry.md").parent.mkdir(parents=True, exist_ok=True)
    (user_dir / "memory" / "entry.md").write_text("hello from vault", encoding="utf-8")
    legacy_vector_dir = managed_tmp_path / "anima-data" / "chroma"
    legacy_vector_dir.mkdir(parents=True, exist_ok=True)
    (legacy_vector_dir / "index.txt").write_text("plaintext index", encoding="utf-8")

    export_response = client.post(
        "/api/vault/export",
        headers={"x-anima-unlock": token},
        json={"passphrase": "vault-pass"},
    )

    assert export_response.status_code == 200
    export_payload = export_response.json()
    envelope = json.loads(export_payload["vault"])
    assert envelope["version"] == 2
    assert "Alice" not in export_payload["vault"]
    assert "plaintext index" not in export_payload["vault"]

    with session_factory() as db:
        db.query(UserKey).delete()
        db.query(User).delete()
        create_user(db, username="bob", password="otherpw", display_name="Bob")

    (user_dir / "memory" / "entry.md").write_text("changed", encoding="utf-8")

    import_response = client.post(
        "/api/vault/import",
        headers={"x-anima-unlock": token},
        json={"passphrase": "vault-pass", "vault": export_payload["vault"]},
    )

    assert import_response.status_code == 200
    import_payload = import_response.json()
    assert import_payload == {
        "status": "ok",
        "restoredUsers": 1,
        "restoredMemoryFiles": 1,
        "requiresReauth": True,
    }

    with session_factory() as db:
        users = db.query(User).all()
        user_keys = db.query(UserKey).all()
        assert [record.username for record in users] == ["alice"]
        assert len(user_keys) == 1

    assert (user_dir / "memory" / "entry.md").read_text(encoding="utf-8") == "hello from vault"
    assert not legacy_vector_dir.exists()

    stale_session_response = client.get(
        "/api/auth/me",
        headers={"x-anima-unlock": token},
    )
    assert stale_session_response.status_code == 401

    login_response = client.post(
        "/api/auth/login",
        json={"username": "alice", "password": "pw123"},
    )
    assert login_response.status_code == 200


def test_import_vault_rejects_wrong_passphrase(
    client: TestClient,
    session_factory: sessionmaker,
    monkeypatch: pytest.MonkeyPatch,
    managed_tmp_path: Path,
) -> None:
    monkeypatch.setattr("anima_server.config.settings.data_dir", managed_tmp_path / "anima-data")
    user = seed_user(session_factory)
    token = unlock_session_store.create(user.id, TEST_DEK)

    export_response = client.post(
        "/api/vault/export",
        headers={"x-anima-unlock": token},
        json={"passphrase": "vault-pass"},
    )
    assert export_response.status_code == 200

    import_response = client.post(
        "/api/vault/import",
        headers={"x-anima-unlock": token},
        json={"passphrase": "wrong-pass", "vault": export_response.json()["vault"]},
    )

    assert import_response.status_code == 400
    assert import_response.json() == {
        "error": "Failed to decrypt vault. Check the passphrase and payload.",
    }
