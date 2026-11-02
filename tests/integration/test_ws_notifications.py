"""End-to-end: WS push on notification."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from social_api.main import create_app
from tests.conftest import register_verified_sync

pytestmark = [pytest.mark.integration]


def _login_for_token(client: TestClient, email: str) -> str:
    pwd = "Str0ng!Passw0rd"
    register_verified_sync(client, email, pwd)
    r = client.post("/api/v1/auth/login", json={"email": email, "password": pwd})
    token: str = r.json()["tokens"]["access_token"]
    return token


def test_ws_receives_follow_notification() -> None:
    app = create_app()
    with TestClient(app) as client:
        token_a = _login_for_token(client, "ws-a@example.com")
        token_b = _login_for_token(client, "ws-b@example.com")

        # A gets their user_id via /me
        a_me = client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token_a}"},
        ).json()
        a_id = a_me["id"]

        # A connects via WS
        with client.websocket_connect(f"/api/v1/ws?token={token_a}") as ws:
            # B follows A -> A should receive notification event
            client.post(
                f"/api/v1/follows/{a_id}",
                headers={"Authorization": f"Bearer {token_b}"},
            )

            # Receive first message (server may send ping first — accept either)
            raw = ws.receive_text()
            event = json.loads(raw)
            # Server may push a "ping"; drain until we see "notification"
            while event.get("type") == "ping":
                raw = ws.receive_text()
                event = json.loads(raw)

            assert event["type"] == "notification"
            payload = event["data"]
            assert payload["type"] == "follow"
            assert payload["unread_delta"] == 1
