"""Locust load test profile.

Run:
    python scripts/seed_demo_data.py          # once — the profile signs in as these
    $env:RATE_LIMIT_ENABLED = "false"         # see "Rate limits" below
    locust -f tests/load/locustfile.py --host=http://localhost:8000

Headless with target:
    locust -f tests/load/locustfile.py --host=http://localhost:8000 `
        --headless --users 5000 --spawn-rate 50 --run-time 3m `
        --csv=tests/load/run --html=tests/load/report.html

Design:
    ReaderUser (weight 8) — GET feed + post
    WriterUser (weight 1) — POST posts + likes + comments
    ChatUser   (weight 1) — POST chat messages

Accounts — why this profile no longer registers:
    ``POST /auth/register`` and ``POST /auth/login`` are rate limited to
    **5/minute per IP** (``modules/auth/router.py``), and the limiter keys on the
    remote address. A load generator drives one API from one IP, so registering
    one account per virtual user can never work: at 5000 users the run spends
    its whole duration collecting 429s. On top of that, ``/auth/login`` now
    refuses unverified accounts (403 ``EMAIL_NOT_VERIFIED``), and a freshly
    registered account is unverified until someone opens the emailed link — a
    load generator cannot.

    So every virtual user borrows one of the **seeded demo accounts** instead
    (``scripts/seed_demo_data.py``: 30 ``@example.com`` users, password
    ``DemoPass123!``, all created with ``is_verified=True``). The token for an
    account is fetched **once per Locust process** and shared by every user
    holding that account, so a 5000-user run costs at most 30 logins instead of
    5000 — no argon2 storm, and no rate-limit wall at spawn.

    Cached tokens are dropped after the server-reported ``expires_in`` (900 s by
    default) so runs longer than the access-token TTL re-authenticate instead of
    silently 401-ing.

Rate limits:
    Even 30 logins per process exceeds 5/minute from one IP, so bootstrap logins
    will 429 while the limiter is on. Run the load test with
    ``RATE_LIMIT_ENABLED=false`` — otherwise you are measuring the limiter, not
    the system. A failed bootstrap raises with that hint instead of every task
    mysteriously returning 401.

Registration:
    Registration is still worth measuring, but only as a deliberate spike, so it
    is opt-in via ``LOAD_TEST_REGISTRATION_SPIKE=1`` (see ``RegistrationSpikeUser``).
    Leaving it in the default mix would re-introduce the 429 wall above.
"""

from __future__ import annotations

import os
import random
import string
import time
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from itertools import cycle

from locust import HttpUser, between, task

# Mirrors DEMO_EMAILS in scripts/seed_demo_data.py (the 30 @example.com
# accounts; the extra non-@example.com admin is deliberately excluded).
DEMO_PASSWORD = "DemoPass123!"
DEMO_ACCOUNTS: tuple[str, ...] = (
    "admin@example.com",
    "mod@example.com",
    "alice@example.com",
    "bob@example.com",
    "carol@example.com",
    *(f"user{i:02d}@example.com" for i in range(1, 26)),
)

# Renew this many seconds before the server-reported expiry, so a token can
# never expire between the check and the request that uses it.
_EXPIRY_MARGIN_SECONDS = 60.0


@dataclass(slots=True)
class _Session:
    """One seeded account's bearer token, shared by every user using it."""

    access_token: str
    user_id: int
    expires_at: float  # time.monotonic() deadline


_SESSIONS: dict[str, _Session] = {}
_ACCOUNTS: Iterator[str] = cycle(DEMO_ACCOUNTS)


def _rand_body() -> str:
    return "".join(
        random.choices(
            string.ascii_letters + " ",
            k=random.randint(20, 200),
        )
    )


def _rand_email() -> str:
    return f"load-{uuid.uuid4().hex[:12]}@example.com"


def _session_for(user: HttpUser, email: str) -> _Session:
    """Return a live session for ``email``, logging in only when needed.

    Locust runs its users as greenlets in one OS thread and switches only at
    I/O points, so a plain dict cache is safe here: two users racing for the
    same account may both log in once, which is harmless (login is idempotent)
    and bounded by the spawn rate.
    """
    cached = _SESSIONS.get(email)
    if cached is not None and time.monotonic() < cached.expires_at:
        return cached

    r = user.client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": DEMO_PASSWORD},
        name="/auth/login (bootstrap)",
    )
    if r.status_code == 429:
        raise RuntimeError(
            "Login bootstrap was rate limited (5/minute per IP). Restart the API "
            "with RATE_LIMIT_ENABLED=false before running this profile — with the "
            "limiter on you would be measuring slowapi, not the application."
        )
    if r.status_code != 200:
        raise RuntimeError(
            f"Login bootstrap for {email} failed with {r.status_code}: {r.text}. "
            "Seed the demo accounts first (python scripts/seed_demo_data.py); they "
            "are created verified, which the login gate requires."
        )

    body = r.json()
    tokens = body["tokens"]
    ttl = float(tokens.get("expires_in") or 900)
    session = _Session(
        access_token=tokens["access_token"],
        user_id=body["user"]["id"],
        expires_at=time.monotonic() + ttl - _EXPIRY_MARGIN_SECONDS,
    )
    _SESSIONS[email] = session
    return session


class BaseUser(HttpUser):
    """Common setup: adopt a seeded demo account and reuse its token."""

    abstract = True

    def on_start(self) -> None:
        self.email = next(_ACCOUNTS)
        session = _session_for(self, self.email)
        self.user_id: int = session.user_id
        self.headers = {"Authorization": f"Bearer {session.access_token}"}


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
    """Chat: 1x weight. Reads rooms and their message pages.

    No room is created on start: a self-DM is rejected by the server, and the
    seeded data already provides direct rooms for some accounts. Users without
    a room simply exercise ``/chat/rooms`` — that is the read shape under test.
    """

    weight = 1
    wait_time = between(1.0, 4.0)

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


_REGISTRATION_SPIKE = os.getenv("LOAD_TEST_REGISTRATION_SPIKE", "").strip().lower() in {
    "1",
    "true",
    "yes",
}

if _REGISTRATION_SPIKE:
    # Opt-in only. Registration is rate limited to 5/minute per IP, so this
    # class measures the endpoint's latency under a small number of concurrent
    # callers — run it with a handful of users, not thousands.
    class RegistrationSpikeUser(HttpUser):
        """Register fresh accounts: the one flow that needs no session."""

        weight = 1
        wait_time = between(30.0, 60.0)

        @task
        def register(self) -> None:
            self.client.post(
                "/api/v1/auth/register",
                json={"email": _rand_email(), "password": DEMO_PASSWORD},
                name="/auth/register",
            )
