from __future__ import annotations

import os

from conftest import managed_test_client


def _register(client):
    """Register a test user and return (user_id, headers_with_unlock_token)."""
    resp = client.post("/api/auth/register", json={
        "username": "tgtest",
        "password": "testpass123",
        "name": "TG Test",
    })
    assert resp.status_code in (200, 201), resp.text
    data = resp.json()
    headers = {"x-anima-unlock": data["unlockToken"]}
    return int(data["id"]), headers


class TestTelegramLinkRoutes:
    """Tests for POST/GET/DELETE /api/telegram/link."""

    def test_link_creates_mapping(self):
        os.environ.pop("TELEGRAM_LINK_SECRET", None)
        with managed_test_client("tg-link-") as client:
            uid, headers = _register(client)
            resp = client.post("/api/telegram/link", json={
                "chatId": 99001, "userId": uid,
            }, headers=headers)
            assert resp.status_code == 201
            data = resp.json()
            assert data["chatId"] == 99001
            assert data["userId"] == uid

    def test_lookup_returns_linked_user(self):
        os.environ.pop("TELEGRAM_LINK_SECRET", None)
        with managed_test_client("tg-lookup-") as client:
            uid, headers = _register(client)
            client.post("/api/telegram/link", json={
                "chatId": 99002, "userId": uid,
            }, headers=headers)
            resp = client.get("/api/telegram/link", params={"chatId": 99002}, headers=headers)
            assert resp.status_code == 200
            assert resp.json()["userId"] == uid

    def test_lookup_returns_404_when_not_linked(self):
        with managed_test_client("tg-404-") as client:
            _, headers = _register(client)
            resp = client.get("/api/telegram/link", params={"chatId": 99999}, headers=headers)
            assert resp.status_code == 404

    def test_unlink_removes_mapping(self):
        os.environ.pop("TELEGRAM_LINK_SECRET", None)
        with managed_test_client("tg-unlink-") as client:
            uid, headers = _register(client)
            client.post("/api/telegram/link", json={
                "chatId": 99003, "userId": uid,
            }, headers=headers)
            resp = client.delete("/api/telegram/link", params={"chatId": 99003}, headers=headers)
            assert resp.status_code == 200
            resp = client.get("/api/telegram/link", params={"chatId": 99003}, headers=headers)
            assert resp.status_code == 404

    def test_link_replaces_existing_for_same_chat(self):
        os.environ.pop("TELEGRAM_LINK_SECRET", None)
        with managed_test_client("tg-replace-") as client:
            uid, headers = _register(client)
            client.post("/api/telegram/link", json={
                "chatId": 99004, "userId": uid,
            }, headers=headers)
            resp = client.post("/api/telegram/link", json={
                "chatId": 99004, "userId": uid,
            }, headers=headers)
            assert resp.status_code == 201

    def test_link_requires_secret_when_configured(self):
        os.environ["TELEGRAM_LINK_SECRET"] = "test-secret-123"
        try:
            with managed_test_client("tg-secret-req-") as client:
                uid, headers = _register(client)
                resp = client.post("/api/telegram/link", json={
                    "chatId": 99005, "userId": uid,
                }, headers=headers)
                assert resp.status_code == 403
        finally:
            os.environ.pop("TELEGRAM_LINK_SECRET", None)

    def test_link_accepts_correct_secret(self):
        os.environ["TELEGRAM_LINK_SECRET"] = "test-secret-123"
        try:
            with managed_test_client("tg-secret-ok-") as client:
                uid, headers = _register(client)
                resp = client.post("/api/telegram/link", json={
                    "chatId": 99006, "userId": uid, "linkSecret": "test-secret-123",
                }, headers=headers)
                assert resp.status_code == 201
        finally:
            os.environ.pop("TELEGRAM_LINK_SECRET", None)

    def test_link_rejects_wrong_secret(self):
        os.environ["TELEGRAM_LINK_SECRET"] = "test-secret-123"
        try:
            with managed_test_client("tg-secret-bad-") as client:
                uid, headers = _register(client)
                resp = client.post("/api/telegram/link", json={
                    "chatId": 99007, "userId": uid, "linkSecret": "wrong",
                }, headers=headers)
                assert resp.status_code == 403
        finally:
            os.environ.pop("TELEGRAM_LINK_SECRET", None)

    def test_link_requires_auth(self):
        with managed_test_client("tg-noauth-") as client:
            resp = client.post("/api/telegram/link", json={
                "chatId": 99008, "userId": 1,
            })
            assert resp.status_code == 401
