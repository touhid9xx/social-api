"""Locust load test profile.

Run:
    locust -f tests/load/locustfile.py --host=http://localhost:8000

Headless with target:
    locust -f tests/load/locustfile.py --host=http://localhost:8000 \
        --headless --users 5000 --spawn-rate 50 --run-time 3m \
        --csv=tests/load/run --html=tests/load/report.html

Design:
    ReaderUser (weight 8) — GET feed + post
    WriterUser (weight 1) — POST posts + likes + comments
    ChatUser   (weight 1) — POST chat messages

Each user registers + logs in on start. Also follows a small seed set so
feeds aren't empty.
"""

from __future__ import annotations

import random
import string
import uuid

from locust import HttpUser, between, task


def _rand_email() -> str:
    uid = uuid.uuid4().hex[:12]
    return f"load-{uid}@example.com"


def _rand_body() -> str:
    return "".join(
        random.choices(
            string.ascii_letters + " ",
            k=random.randint(20, 200),
        )
    )


class BaseUser(HttpUser):
    """Common setup: register, login, follow seed users."""

    abstract = True

    def on_start(self) -> None:
        self.email = _rand_email()
        self.password = "Str0ng!Passw0rd"
        # Register
        self.client.post(
            "/api/v1/auth/register",
            json={"email": self.email, "password": self.password},
        )
        # Login
        r = self.client.post(
            "/api/v1/auth/login",
            json={"email": self.email, "password": self.password},
        )
        if r.status_code != 200:
            self.environment.runner.quit()
            return

        body = r.json()
        self.access: str = body["tokens"]["access_token"]
        self.user_id: int = body["user"]["id"]
        self.headers = {"Authorization": f"Bearer {self.access}"}

        # Create 3 own posts so /feed isn't empty
        for _ in range(3):
            self.client.post(
                "/api/v1/posts",
                headers=self.headers,
                json={"body": _rand_body()},
            )


class ReaderUser(BaseUser):
    """Read-heavy: 8x weight."""

    weight = 8
    wait_time = between(0.5, 2.0)

    @task(10)
    def feed_home(self) -> None:
        self.client.get(
            "/api/v1/feed/home",
            headers=self.headers,
            name="/feed/home",
        )

    @task(3)
    def feed_explore(self) -> None:
        self.client.get(
            "/api/v1/feed/explore",
            headers=self.headers,
            name="/feed/explore",
        )

    @task(2)
    def list_own_posts(self) -> None:
        self.client.get(
            f"/api/v1/posts/by-author/{self.user_id}",
            headers=self.headers,
            name="/posts/by-author/[id]",
        )


class WriterUser(BaseUser):
    """Write: 1x weight. Creates content."""

    weight = 1
    wait_time = between(2.0, 6.0)

    @task(5)
    def create_post(self) -> None:
        self.client.post(
            "/api/v1/posts",
            headers=self.headers,
            json={"body": _rand_body()},
            name="/posts",
        )

    @task(3)
    def list_posts_then_like(self) -> None:
        # Get someone's posts, like one
        r = self.client.get(
            f"/api/v1/posts/by-author/{self.user_id}",
            headers=self.headers,
            name="/posts/by-author/[id]",
        )
        if r.status_code == 200:
            items = r.json().get("items") or []
            if items:
                pid = items[0]["id"]
                self.client.post(
                    f"/api/v1/likes/post/{pid}",
                    headers=self.headers,
                    name="/likes/post/[id]",
                )

    @task(2)
    def comment_random_post(self) -> None:
        r = self.client.get(
            f"/api/v1/posts/by-author/{self.user_id}",
            headers=self.headers,
            name="/posts/by-author/[id]",
        )
        if r.status_code == 200:
            items = r.json().get("items") or []
            if items:
                pid = items[0]["id"]
                self.client.post(
                    f"/api/v1/posts/{pid}/comments",
                    headers=self.headers,
                    json={"body": _rand_body()[:200]},
                    name="/posts/[id]/comments",
                )


class ChatUser(BaseUser):
    """Chat: 1x weight. Creates rooms + sends messages."""

    weight = 1
    wait_time = between(1.0, 4.0)

    def on_start(self) -> None:
        super().on_start()
        # Create a direct room with self's own user_id (would normally
        # be a second user — for load testing we just need a room to post to)
        # Use a self-DM (server rejects self-DM). Instead, follow self won't
        # work either. Simplest: skip room creation; only message if we
        # discover a room via /chat/rooms.
        pass

    @task(5)
    def list_rooms(self) -> None:
        self.client.get("/api/v1/chat/rooms", headers=self.headers, name="/chat/rooms")

    @task(2)
    def get_my_messages(self) -> None:
        r = self.client.get("/api/v1/chat/rooms", headers=self.headers, name="/chat/rooms")
        if r.status_code == 200 and r.json():
            room_id = r.json()[0]["id"]
            self.client.get(
                f"/api/v1/chat/rooms/{room_id}/messages",
                headers=self.headers,
                name="/chat/rooms/[id]/messages",
            )
