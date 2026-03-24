from __future__ import annotations

from conftest import managed_test_client
from fastapi.testclient import TestClient


def _register_user(
    client: TestClient,
    *,
    username: str = "alice",
    password: str = "pw123456",
    name: str = "Alice",
) -> dict[str, object]:
    response = client.post(
        "/api/auth/register",
        json={"username": username, "password": password, "name": name},
    )
    assert response.status_code == 201
    return response.json()


def test_register_returns_recovery_phrase() -> None:
    with managed_test_client("anima-recovery-test-") as client:
        payload = _register_user(client)

        assert "recoveryPhrase" in payload
        phrase = str(payload["recoveryPhrase"])
        words = phrase.split()
        assert len(words) == 12, f"Expected 12 words, got {len(words)}"
        # Each word should be lowercase alphabetic
        for word in words:
            assert word.isalpha(), f"Non-alpha word: {word}"


def test_recover_account_with_valid_phrase() -> None:
    with managed_test_client("anima-recovery-test-") as client:
        register_payload = _register_user(client, password="old-password")
        phrase = str(register_payload["recoveryPhrase"])

        # Recover with the phrase and a new password
        recover_response = client.post(
            "/api/auth/recover",
            json={"recoveryPhrase": phrase, "newPassword": "new-password"},
        )

        assert recover_response.status_code == 200
        recover_payload = recover_response.json()
        assert recover_payload["username"] == "alice"
        assert recover_payload["name"] == "Alice"
        assert recover_payload["message"] == "Account recovered successfully"
        assert "unlockToken" in recover_payload

        # Old password should no longer work
        old_login = client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "old-password"},
        )
        assert old_login.status_code == 401

        # New password should work
        new_login = client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "new-password"},
        )
        assert new_login.status_code == 200


def test_recover_with_wrong_phrase_fails() -> None:
    with managed_test_client("anima-recovery-test-") as client:
        _register_user(client)

        recover_response = client.post(
            "/api/auth/recover",
            json={
                "recoveryPhrase": "wrong words here that are not the right phrase at all nope",
                "newPassword": "new-password",
            },
        )

        assert recover_response.status_code == 401


def test_recover_then_login_and_use_api() -> None:
    with managed_test_client("anima-recovery-test-") as client:
        register_payload = _register_user(client, password="original-pw")
        phrase = str(register_payload["recoveryPhrase"])

        # Recover
        recover_response = client.post(
            "/api/auth/recover",
            json={"recoveryPhrase": phrase, "newPassword": "recovered-pw"},
        )
        assert recover_response.status_code == 200
        unlock_token = recover_response.json()["unlockToken"]

        # Use the unlock token to access /me
        me_response = client.get(
            "/api/auth/me",
            headers={"x-anima-unlock": unlock_token},
        )
        assert me_response.status_code == 200
        assert me_response.json()["username"] == "alice"
