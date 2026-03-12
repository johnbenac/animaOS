from __future__ import annotations

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from anima_server.db.base import Base
from anima_server.db.session import get_db
from anima_server.main import create_app
from anima_server.services.auth import create_user
from anima_server.services.sessions import get_active_dek, unlock_session_store


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


def test_register_creates_user_and_unlock_session(client: TestClient) -> None:
    response = client.post(
        "/api/auth/register",
        json={
            "username": "Alice",
            "password": "pw123",
            "name": "Alice",
            "personaTemplate": "alice",
        },
    )

    assert response.status_code == 201
    payload = response.json()

    assert payload["username"] == "alice"
    assert payload["name"] == "Alice"
    assert isinstance(payload["unlockToken"], str)
    assert payload["unlockToken"]
    assert get_active_dek(payload["id"]) is not None

    me_response = client.get(
        "/api/auth/me",
        headers={"x-anima-unlock": payload["unlockToken"]},
    )
    assert me_response.status_code == 200
    assert me_response.json()["username"] == "alice"


def test_login_me_and_logout_use_the_same_unlock_token(
    client: TestClient,
    session_factory: sessionmaker,
) -> None:
    with session_factory() as db:
        create_user(db, username="alice", password="pw123", display_name="Alice")

    login_response = client.post(
        "/api/auth/login",
        json={"username": "Alice", "password": "pw123"},
    )

    assert login_response.status_code == 200
    login_payload = login_response.json()
    assert login_payload["name"] == "Alice"
    assert login_payload["message"] == "Login successful"
    assert get_active_dek(login_payload["id"]) is not None

    headers = {"x-anima-unlock": login_payload["unlockToken"]}

    me_response = client.get("/api/auth/me", headers=headers)
    assert me_response.status_code == 200
    assert me_response.json()["name"] == "Alice"

    logout_response = client.post("/api/auth/logout", headers=headers)
    assert logout_response.status_code == 200
    assert logout_response.json() == {"success": True}

    locked_response = client.get("/api/auth/me", headers=headers)
    assert locked_response.status_code == 401
    assert locked_response.json() == {"error": "Session locked."}


def test_login_rejects_invalid_credentials(
    client: TestClient,
    session_factory: sessionmaker,
) -> None:
    with session_factory() as db:
        create_user(db, username="alice", password="right-password", display_name="Alice")

    response = client.post(
        "/api/auth/login",
        json={"username": "alice", "password": "wrong-password"},
    )

    assert response.status_code == 401
    assert response.json() == {"error": "Invalid credentials"}

def test_change_password_rewraps_existing_dek_and_rotates_unlock_token(
    client: TestClient,
) -> None:
    register_response = client.post(
        "/api/auth/register",
        json={
            "username": "change-me",
            "password": "old-password",
            "name": "Change Me",
        },
    )
    assert register_response.status_code == 201
    register_payload = register_response.json()
    user_id = register_payload["id"]
    old_unlock_token = register_payload["unlockToken"]
    old_dek = get_active_dek(user_id)
    assert old_dek is not None

    change_response = client.post(
        "/api/auth/change-password",
        headers={"x-anima-unlock": old_unlock_token},
        json={
            "oldPassword": "old-password",
            "newPassword": "new-password",
        },
    )

    assert change_response.status_code == 200
    change_payload = change_response.json()
    assert change_payload["success"] is True
    assert change_payload["unlockToken"] != old_unlock_token
    assert get_active_dek(user_id) == old_dek

    old_token_me = client.get(
        "/api/auth/me",
        headers={"x-anima-unlock": old_unlock_token},
    )
    assert old_token_me.status_code == 401

    new_token_me = client.get(
        "/api/auth/me",
        headers={"x-anima-unlock": change_payload["unlockToken"]},
    )
    assert new_token_me.status_code == 200

    old_login = client.post(
        "/api/auth/login",
        json={"username": "change-me", "password": "old-password"},
    )
    assert old_login.status_code == 401

    new_login = client.post(
        "/api/auth/login",
        json={"username": "change-me", "password": "new-password"},
    )
    assert new_login.status_code == 200


def test_change_password_rejects_wrong_old_password(client: TestClient) -> None:
    register_response = client.post(
        "/api/auth/register",
        json={
            "username": "stay-same",
            "password": "old-password",
            "name": "Stay Same",
        },
    )
    assert register_response.status_code == 201
    register_payload = register_response.json()

    change_response = client.post(
        "/api/auth/change-password",
        headers={"x-anima-unlock": register_payload["unlockToken"]},
        json={
            "oldPassword": "wrong-password",
            "newPassword": "new-password",
        },
    )

    assert change_response.status_code == 401
    assert change_response.json() == {"error": "Invalid credentials"}
