"""Seed demo data for local development and frontend testing.

Deterministic, idempotent, transactional. Writes real PNG bytes to
MEDIA_ROOT so <img src> works without 404.

Usage:
    python scripts/seed_demo_data.py                 # ~215 records
    python scripts/seed_demo_data.py --scale 2       # ~430 records
    python scripts/seed_demo_data.py --reset         # delete demo users first
    python scripts/seed_demo_data.py --dry-run       # count-only, no insert
    python scripts/seed_demo_data.py --seed 0        # non-deterministic

Avatar URL modes:
    --avatar local     (default) — writes data/media/avatars/{uid}.png and
                                    sets avatar_url=/media/avatars/{uid}.png
                                    Use when your app serves MEDIA_ROOT at /media/*
    --avatar external  — sets avatar_url to a public UI Avatars URL
                                    Use when /media/* is not mounted

Demo credentials (all users, password `DemoPass123!`):
    admin@example.com     (admin)
    mod@example.com       (moderator)
    alice@example.com     (celebrity, everyone follows her)
    bob@example.com
    carol@example.com
    ... (15 more regular users)
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import struct
import sys
import uuid
import zlib
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from random import Random

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from sqlalchemy import delete, select  # noqa: E402

from social_api.config import get_settings  # noqa: E402
from social_api.core.password import hash_password  # noqa: E402
from social_api.core.security import hash_email  # noqa: E402
from social_api.db.session import get_sessionmaker  # noqa: E402
from social_api.modules.audit.models import AuditLog  # noqa: E402
from social_api.modules.auth.models import User, UserRole  # noqa: E402
from social_api.modules.chat.models import (  # noqa: E402
    ChatRoom,
    ChatRoomMember,
    MemberRole,
    Message,
    RoomType,
)
from social_api.modules.comments.models import Comment  # noqa: E402
from social_api.modules.follows.models import Block, Follow, Mute  # noqa: E402
from social_api.modules.likes.models import Like, LikeTarget  # noqa: E402
from social_api.modules.media.models import Media, MediaKind  # noqa: E402
from social_api.modules.moderation.models import (  # noqa: E402
    Report,
    ReportReason,
    ReportStatus,
    ReportTargetType,
)
from social_api.modules.notifications.models import (  # noqa: E402
    Notification,
    NotificationTargetType,
    NotificationType,
)
from social_api.modules.posts.models import Post  # noqa: E402
from social_api.modules.users.models import (  # noqa: E402
    ConsentChannel,
    Profile,
    UserConsent,
    Visibility,
)

DEMO_PASSWORD = "DemoPass123!"
DEMO_EMAILS = [
    "admin@example.com",
    "mod@example.com",
    "alice@example.com",
    "bob@example.com",
    "carol@example.com",
    *[f"user{i:02d}@example.com" for i in range(1, 16)],
]


# =============================================================================
# Helpers — datetimes
# =============================================================================
def _now_naive() -> datetime:
    """UTC-naive `now()` — matches DateTime(timezone=False) columns."""
    return datetime.now(UTC).replace(tzinfo=None)


def _rand_dt(now: datetime, max_days: int, rng: Random) -> datetime:
    return now - timedelta(
        days=rng.randint(0, max_days),
        hours=rng.randint(0, 23),
        minutes=rng.randint(0, 59),
    )


def _rand_day(now: datetime, max_days: int, rng: Random) -> date:
    return (now - timedelta(days=rng.randint(0, max_days))).date()


# =============================================================================
# Helpers — minimal PNG generator (no Pillow dependency)
# =============================================================================
def _generate_png(seed: int, size: int = 128) -> bytes:
    """Generate a small valid PNG (solid color, deterministic per seed).

    Hand-rolls the PNG format — no external dependency. 128x128 solid
    RGB compresses to ~150 bytes. Enough for <img src> to render without
    a 404, which is what the frontend cares about during development.

    Each seed produces a different color, so a gallery of images has
    visible variety.
    """
    r = (seed * 67) % 256
    g = (seed * 131) % 256
    b = (seed * 197) % 256

    def _chunk(tag: bytes, data: bytes) -> bytes:
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit RGB
    row = b"\x00" + bytes([r, g, b]) * size
    idat = zlib.compress(row * size, 9)
    return sig + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", idat) + _chunk(b"IEND", b"")


def _write_media_file(media_root: Path, storage_key: str, data: bytes) -> bool:
    """Write bytes to MEDIA_ROOT/storage_key, creating parent dirs.

    Returns True if the file was actually written (not skipped).
    """
    target = media_root / storage_key
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        target.write_bytes(data)
        return True
    return False


# =============================================================================
# Seed
# =============================================================================
async def seed(
    *,
    scale: int = 1,
    reset: bool = False,
    dry_run: bool = False,
    rng_seed: int = 42,
    avatar_mode: str = "local",
) -> dict[str, int]:
    rng = Random(rng_seed)  # noqa: S311 — seed script; not a security boundary
    now = _now_naive()
    counts: dict[str, int] = {}

    def bump(k: str, n: int = 1) -> None:
        counts[k] = counts.get(k, 0) + n

    settings = get_settings()
    media_root = Path(settings.media_root)
    print(f">> [media] MEDIA_ROOT = {media_root}")

    sm = get_sessionmaker()

    async with sm() as session:
        # ---- Reset (demo users + cascade) ----------------------------------
        if reset:
            print(">> [reset] deleting demo users (cascades to their data)...")
            demo_users = (
                (
                    await session.execute(
                        select(User).where(
                            User.email_hash.in_([hash_email(e) for e in DEMO_EMAILS])
                        )
                    )
                )
                .scalars()
                .all()
            )
            if demo_users:
                ids = [u.id for u in demo_users]
                await session.execute(delete(User).where(User.id.in_(ids)))
                await session.commit()
                print(f"   deleted {len(ids)} demo users + cascaded rows")
            else:
                print("   no demo users found")

        # ---- Idempotency guard ---------------------------------------------
        # Uses DEMO_EMAILS[0] so the guard tracks the domain automatically
        # if DEMO_EMAILS changes.
        existing = (
            await session.execute(
                select(User).where(User.email_hash == hash_email(DEMO_EMAILS[0]))
            )
        ).scalar_one_or_none()
        if existing is not None:
            print(">> [skip] demo data already present. Use --reset to re-seed.")
            return counts

        if dry_run:
            print(">> [dry-run] would insert ~215 records; no changes made.")
            return counts

        # =====================================================================
        # 1. Users (20)
        # =====================================================================
        pw_hash = hash_password(DEMO_PASSWORD)
        users: list[User] = []

        role_map = [
            (DEMO_EMAILS[0], UserRole.ADMIN),
            (DEMO_EMAILS[1], UserRole.MODERATOR),
            *[(e, UserRole.USER) for e in DEMO_EMAILS[2:]],
        ]

        for email, role in role_map:
            u = User(
                email=email,
                email_hash=hash_email(email),
                password_hash=pw_hash,
                role=role,
                is_active=True,
                is_verified=True,
                created_at=_rand_dt(now, 90, rng),
            )
            session.add(u)
            users.append(u)
            bump("users")
        await session.flush()
        print(f"[ 1/16] users: {len(users)}")

        # =====================================================================
        # 2. Profiles (1 per user) — writes avatar PNGs (local mode)
        # =====================================================================
        names = [
            "Admin",
            "Mod",
            "Alice (celebrity)",
            "Bob",
            "Carol",
            *[f"User {i:02d}" for i in range(1, 16)],
        ]
        bios = [
            "Building social things.",
            "Just here for the memes.",
            "Coffee, code, cats.",
            "Photographer. Traveler.",
            "Silent lurker.",
            None,
            None,
            None,
        ]

        avatars_written = 0
        for u, name in zip(users, names, strict=True):
            if avatar_mode == "local":
                avatar_key = f"avatars/{u.id}.png"
                png_bytes = _generate_png(seed=u.id, size=128)
                was_written = _write_media_file(media_root, avatar_key, png_bytes)
                if was_written:
                    avatars_written += 1
                avatar_url_value = f"/static/media/{avatar_key}"
                print(
                    f"   avatar: user_id={u.id} key={avatar_key} "
                    f"bytes={len(png_bytes)} new={was_written}"
                )
            else:
                avatar_url_value = (
                    "https://ui-avatars.com/api/"
                    f"?name={name.replace(' ', '+')}&size=128"
                )

            profile = Profile(
                user_id=u.id,
                display_name=name,
                bio=rng.choice(bios),
                avatar_url=avatar_url_value,
                location=rng.choice(["Dhaka", "London", "Berlin", None]),
                website=rng.choice(["https://example.com", None]),
                visibility=rng.choice(
                    [Visibility.PUBLIC, Visibility.PUBLIC, Visibility.FOLLOWERS]
                ),
                pii_visibility=Visibility.PRIVATE,
                dob=rng.choice(["1990-05-15", None]),
                phone=rng.choice(["+8801700000000", None]),
                created_at=u.created_at,
            )
            session.add(profile)
            bump("profiles")
        await session.flush()
        print(f"[ 2/16] profiles: {counts['profiles']} (avatars written: {avatars_written})")

        # =====================================================================
        # 3. Consents
        # =====================================================================
        for u in users[:15]:
            for ch in rng.sample(list(ConsentChannel), k=rng.randint(1, 3)):
                granted = rng.random() < 0.7
                consent = UserConsent(
                    user_id=u.id,
                    channel=ch,
                    granted=granted,
                    granted_at=u.created_at,
                    revoked_at=(
                        None
                        if granted
                        else u.created_at + timedelta(days=rng.randint(1, 10))
                    ),
                    ip="127.0.0.1",
                    user_agent="seed-script",
                    created_at=u.created_at,
                )
                session.add(consent)
                bump("user_consent")
        await session.flush()
        print(f"[ 3/16] user_consent: {counts['user_consent']}")

        # =====================================================================
        # 4. Follows (make alice a celebrity)
        # =====================================================================
        _admin, mod, alice, bob, carol = users[:5]
        seen_follows: set[tuple[int, int]] = set()

        def follow(follower: User, followee: User) -> None:
            key = (follower.id, followee.id)
            if follower.id == followee.id or key in seen_follows:
                return
            seen_follows.add(key)
            session.add(
                Follow(
                    follower_id=follower.id,
                    followee_id=followee.id,
                    created_at=_rand_dt(now, 60, rng),
                )
            )
            bump("follows")

        # Everybody follows alice (celebrity)
        for u in users:
            if u.id != alice.id:
                follow(u, alice)
        # Alice follows a few back
        for u in rng.sample(users, 5):
            if u.id != alice.id:
                follow(alice, u)
        # Normal graph
        for u in users:
            for v in rng.sample(users, k=rng.randint(2, 5)):
                follow(u, v)
        await session.flush()
        print(f"[ 4/16] follows: {counts['follows']}")

        # =====================================================================
        # 5. Blocks + Mutes
        # =====================================================================
        session.add(Block(blocker_id=bob.id, blocked_id=carol.id, created_at=now))
        session.add(Block(blocker_id=carol.id, blocked_id=bob.id, created_at=now))
        bump("blocks", 2)

        mute_pairs = rng.sample(
            [(u.id, v.id) for u in users[:10] for v in users[:10] if u.id != v.id],
            k=6,
        )
        for muter_id, muted_id in mute_pairs:
            session.add(Mute(muter_id=muter_id, muted_id=muted_id, created_at=now))
            bump("mutes")
        await session.flush()
        print(f"[ 5/16] blocks+mutes: {counts['blocks']}+{counts['mutes']}")

        # =====================================================================
        # 6. Posts (40)
        # =====================================================================
        post_bodies = [
            "hello world",
            "my first post",
            "coffee time",
            "sunset today",
            "shipping a feature",
            "weekend vibes",
            "cold brew gang",
            "deep work session",
            "reading list",
            "gym done",
            "weekend plans?",
            "anyone else noticed...",
            "sunday reset",
            "monday again",
            "new keyboard day",
            "the cat is asleep",
            "trying a new recipe",
            "anyone up?",
            "weekend read",
            "just shipped a fix",
        ]
        posts: list[Post] = []
        for i in range(40):
            post = Post(
                author_id=rng.choice(users).id,
                body=rng.choice(post_bodies) + f" #{i}",
                visibility=rng.choice([Visibility.PUBLIC] * 8 + [Visibility.FOLLOWERS]),
                created_at=_rand_dt(now, 60, rng),
            )
            session.add(post)
            posts.append(post)
            bump("posts")
        # Soft-delete one post (frontend can test "deleted" rendering)
        posts[5].deleted_at = now - timedelta(days=3)
        await session.flush()
        print(f"[ 6/16] posts: {counts['posts']}")

        # =====================================================================
        # 7. Comments (30; 20 top-level + 10 nested depth-2)
        # =====================================================================
        top_comments: list[Comment] = []
        for i in range(20):
            post = rng.choice(posts)
            comment = Comment(
                post_id=post.id,
                author_id=rng.choice(users).id,
                parent_id=None,
                depth=1,
                body=f"top comment {i}",
                created_at=_rand_dt(now, 55, rng),
            )
            session.add(comment)
            top_comments.append(comment)
            bump("comments")
        await session.flush()

        for i in range(10):
            parent = rng.choice(top_comments)
            reply = Comment(
                post_id=parent.post_id,
                author_id=rng.choice(users).id,
                parent_id=parent.id,
                depth=2,
                body=f"reply {i}",
                created_at=parent.created_at + timedelta(hours=rng.randint(1, 48)),
            )
            session.add(reply)
            bump("comments")
        await session.flush()
        print(f"[ 7/16] comments: {counts['comments']}")

        # =====================================================================
        # 8. Likes (30 on posts + 10 on comments)
        # =====================================================================
        seen_likes: set[tuple[int, str, int]] = set()

        def like(user_id: int, tt: LikeTarget, tid: int) -> None:
            key = (user_id, tt.value, tid)
            if key in seen_likes:
                return
            seen_likes.add(key)
            session.add(
                Like(
                    user_id=user_id,
                    target_type=tt,
                    target_id=tid,
                    created_at=_rand_dt(now, 55, rng),
                )
            )
            bump("likes")

        for _ in range(30):
            like(rng.choice(users).id, LikeTarget.POST, rng.choice(posts).id)
        for _ in range(10):
            like(
                rng.choice(users).id,
                LikeTarget.COMMENT,
                rng.choice(top_comments).id,
            )
        await session.flush()
        print(f"[ 8/16] likes: {counts['likes']}")

        # =====================================================================
        # 9. Media (10 post-attached + 5 orphan) — real PNG bytes on disk
        # =====================================================================
        medias: list[Media] = []
        for i in range(10):
            owner = rng.choice(users)
            png_bytes = _generate_png(seed=1000 + i, size=512)
            sha = hashlib.sha256(png_bytes).hexdigest()
            storage_key = f"posts/{sha[:16]}.png"
            _write_media_file(media_root, storage_key, png_bytes)
            post_media = Media(
                owner_id=owner.id,
                post_id=rng.choice(posts).id,
                message_id=None,
                sha256=sha,
                mime="image/png",
                kind=MediaKind.IMAGE,
                size_bytes=len(png_bytes),
                storage_key=storage_key,
                original_name=f"post-{i}.png",
                created_at=_rand_dt(now, 55, rng),
            )
            session.add(post_media)
            medias.append(post_media)
            bump("media")

        for i in range(5):
            owner = rng.choice(users)
            png_bytes = _generate_png(seed=2000 + i, size=512)
            sha = hashlib.sha256(png_bytes).hexdigest()
            storage_key = f"orphans/{sha[:16]}.png"
            _write_media_file(media_root, storage_key, png_bytes)
            orphan_media = Media(
                owner_id=owner.id,
                post_id=None,
                message_id=None,
                sha256=sha,
                mime="image/png",
                kind=MediaKind.IMAGE,
                size_bytes=len(png_bytes),
                storage_key=storage_key,
                original_name=f"orphan-{i}.png",
                created_at=_rand_dt(now, 55, rng),
            )
            session.add(orphan_media)
            medias.append(orphan_media)
            bump("media")
        await session.flush()
        print(f"[ 9/16] media: {counts['media']}")

        # Set post.media_count from real associations
        post_media_count: dict[int, int] = {}
        for media in medias:
            if media.post_id is not None:
                post_media_count[media.post_id] = post_media_count.get(media.post_id, 0) + 1
        for post in posts:
            post.media_count = post_media_count.get(post.id, 0)
        await session.flush()

        # =====================================================================
        # 10. Chat rooms (3 direct + 3 group)
        # =====================================================================
        rooms: list[ChatRoom] = []

        for _ in range(3):
            a, b = rng.sample(users[:10], k=2)
            lo, hi = sorted((a.id, b.id))
            direct_room = ChatRoom(
                type=RoomType.DIRECT,
                canonical_user_a=lo,
                canonical_user_b=hi,
                title=None,
                created_at=_rand_dt(now, 30, rng),
            )
            session.add(direct_room)
            rooms.append(direct_room)
            bump("chat_rooms")
        await session.flush()

        for _ in range(3):
            group_room = ChatRoom(
                type=RoomType.GROUP,
                canonical_user_a=None,
                canonical_user_b=None,
                title=f"Group #{rng.randint(1, 99)}",
                created_at=_rand_dt(now, 30, rng),
            )
            session.add(group_room)
            rooms.append(group_room)
            bump("chat_rooms")
        await session.flush()
        print(f"[10/16] chat_rooms: {counts['chat_rooms']}")

        # =====================================================================
        # 11. Chat room members
        # =====================================================================
        for room in rooms:
            if room.type == RoomType.DIRECT:
                members_ids = [room.canonical_user_a, room.canonical_user_b]
                member_roles = [MemberRole.MEMBER, MemberRole.MEMBER]
            else:
                members_ids = rng.sample([u.id for u in users[:10]], k=rng.randint(2, 4))
                member_roles = [MemberRole.ADMIN] + [MemberRole.MEMBER] * (len(members_ids) - 1)
            for uid, mrole in zip(members_ids, member_roles, strict=True):
                session.add(
                    ChatRoomMember(
                        room_id=room.id,
                        user_id=uid,
                        role=mrole,
                        last_read_message_id=None,
                        joined_at=room.created_at,
                    )
                )
                bump("chat_room_members")
        await session.flush()
        print(f"[11/16] chat_room_members: {counts['chat_room_members']}")

        # =====================================================================
        # 12. Messages (25) — some with real media bytes
        # =====================================================================
        msgs: list[Message] = []
        message_media: list[Media] = []
        for i in range(25):
            room = rng.choice(rooms)
            member_ids = (
                (
                    await session.execute(
                        select(ChatRoomMember.user_id).where(
                            ChatRoomMember.room_id == room.id
                        )
                    )
                )
                .scalars()
                .all()
            )
            sender = rng.choice(member_ids)

            # Attach a PNG to the first 2 messages
            if i < 2:
                png_bytes = _generate_png(seed=3000 + i, size=512)
                sha = hashlib.sha256(png_bytes).hexdigest()
                storage_key = f"messages/{sha[:16]}.png"
                _write_media_file(media_root, storage_key, png_bytes)
                chat_media = Media(
                    owner_id=sender,
                    post_id=None,
                    message_id=None,
                    sha256=sha,
                    mime="image/png",
                    kind=MediaKind.IMAGE,
                    size_bytes=len(png_bytes),
                    storage_key=storage_key,
                    original_name=f"chat-{i}.png",
                    created_at=_rand_dt(now, 20, rng),
                )
                session.add(chat_media)
                message_media.append(chat_media)
                bump("media")

            msg = Message(
                room_id=room.id,
                sender_id=sender,
                body=f"message {i}",
                media_id=None,
                created_at=_rand_dt(now, 20, rng),
            )
            session.add(msg)
            msgs.append(msg)
            bump("messages")
        await session.flush()

        # Wire message_id -> message and messages.media_id -> media
        for msg, media in zip(msgs[:2], message_media, strict=False):
            media.message_id = msg.id
            msg.media_id = media.id
        await session.flush()

        # Read receipts — half of members have read the latest
        for room in rooms:
            room_msgs = [msg for msg in msgs if msg.room_id == room.id]
            if not room_msgs:
                continue
            latest = max(room_msgs, key=lambda msg: msg.id)
            member_rows = (
                (
                    await session.execute(
                        select(ChatRoomMember).where(ChatRoomMember.room_id == room.id)
                    )
                )
                .scalars()
                .all()
            )
            for idx, member in enumerate(member_rows):
                if idx % 2 == 0:
                    member.last_read_message_id = latest.id
        await session.flush()
        print(f"[12/16] messages: {counts['messages']}")

        # =====================================================================
        # 13. Notifications (30)
        # =====================================================================
        seen_n: set[tuple[int, int, str, str, int, date]] = set()

        def notif(
            *,
            recipient: int,
            actor: int,
            ntype: NotificationType,
            tt: NotificationTargetType,
            tid: int,
            is_read: bool,
        ) -> None:
            day = _rand_day(now, 30, rng)
            key = (recipient, actor, ntype.value, tt.value, tid, day)
            if key in seen_n:
                return
            seen_n.add(key)
            session.add(
                Notification(
                    user_id=recipient,
                    actor_id=actor,
                    type=ntype,
                    target_type=tt,
                    target_id=tid,
                    is_read=is_read,
                    read_at=_rand_dt(now, 5, rng) if is_read else None,
                    day_bucket=day,
                    preview=None,
                    created_at=_rand_dt(now, 30, rng),
                )
            )
            bump("notifications")

        # Follow notifications
        for _ in range(10):
            follower_id, followee_id = rng.choice(list(seen_follows))
            notif(
                recipient=followee_id,
                actor=follower_id,
                ntype=NotificationType.FOLLOW,
                tt=NotificationTargetType.USER,
                tid=follower_id,
                is_read=rng.random() < 0.5,
            )
        # Post-like notifications
        for _ in range(10):
            post = rng.choice(posts)
            notif(
                recipient=post.author_id,
                actor=rng.choice(users).id,
                ntype=NotificationType.LIKE_POST,
                tt=NotificationTargetType.POST,
                tid=post.id,
                is_read=rng.random() < 0.5,
            )
        # Post-comment notifications
        for _ in range(10):
            comment = rng.choice(top_comments)
            post = next(p for p in posts if p.id == comment.post_id)
            notif(
                recipient=post.author_id,
                actor=comment.author_id,
                ntype=NotificationType.COMMENT_POST,
                tt=NotificationTargetType.POST,
                tid=post.id,
                is_read=rng.random() < 0.5,
            )
        await session.flush()
        print(f"[13/16] notifications: {counts['notifications']}")

        # =====================================================================
        # 14. Reports (5 — one per status)
        # =====================================================================
        status_cycle = [
            ReportStatus.OPEN,
            ReportStatus.UNDER_REVIEW,
            ReportStatus.RESOLVED,
            ReportStatus.DISMISSED,
            ReportStatus.OPEN,
        ]
        seen_reports: set[tuple[int, str, int, date]] = set()
        for i, status in enumerate(status_cycle):
            reporter = rng.choice(users[2:])
            post = rng.choice(posts)
            day = _rand_day(now, 15, rng)
            key = (reporter.id, "post", post.id, day)
            if key in seen_reports:
                continue
            seen_reports.add(key)
            report = Report(
                reporter_id=reporter.id,
                target_type=ReportTargetType.POST,
                target_id=post.id,
                reason=rng.choice(list(ReportReason)),
                details=f"report details {i}",
                status=status,
                reviewer_id=mod.id if status != ReportStatus.OPEN else None,
                resolution_note=("resolved" if status == ReportStatus.RESOLVED else None),
                resolved_at=(
                    _rand_dt(now, 5, rng)
                    if status in {ReportStatus.RESOLVED, ReportStatus.DISMISSED}
                    else None
                ),
                day_bucket=day,
                created_at=_rand_dt(now, 20, rng),
            )
            session.add(report)
            bump("reports")
        await session.flush()
        print(f"[14/16] reports: {counts['reports']}")

        # =====================================================================
        # 15. Audit log (20)
        # =====================================================================
        actions = [
            "REGISTER",
            "LOGIN",
            "POST_CREATED",
            "POST_DELETED",
            "COMMENT_CREATED",
            "LIKE_CREATED",
            "FOLLOW_CREATED",
            "MODERATION_STATUS_UPDATE",
            "GDPR_DELETE_SCHEDULED",
        ]
        for _ in range(20):
            actor_user = rng.choice(users)
            entity, entity_id = rng.choice(
                [
                    ("user", actor_user.id),
                    ("post", rng.choice(posts).id),
                    ("comment", rng.choice(top_comments).id),
                ]
            )
            audit = AuditLog(
                actor_id=actor_user.id,
                action=rng.choice(actions),
                entity=entity,
                entity_id=entity_id,
                before=None,
                after={"demo": True},
                ip="127.0.0.1",
                user_agent="seed-script",
                request_id=uuid.uuid4().hex,
                created_at=_rand_dt(now, 30, rng),
            )
            session.add(audit)
            bump("audit_log")
        await session.flush()
        print(f"[15/16] audit_log: {counts['audit_log']}")

        # =====================================================================
        # 16. Commit
        # =====================================================================
        await session.commit()
        print(f"[16/16] committed. total records: {sum(counts.values())}")

    return counts


# =============================================================================
# CLI
# =============================================================================
def _summarize(counts: dict[str, int], scale: int, media_root: Path) -> None:
    print()
    print("=" * 60)
    print(f"Seed complete (scale={scale})")
    print("=" * 60)
    for k in sorted(counts):
        print(f"  {k:<22} {counts[k]:>5}")
    print(f"  {'TOTAL':<22} {sum(counts.values()):>5}")
    print()
    print(f"Media files written to: {media_root.resolve()}")
    print()
    print("Demo credentials (password: DemoPass123!):")
    for e in DEMO_EMAILS[:5]:
        print(f"  {e}")
    print(f"  ... + {len(DEMO_EMAILS) - 5} more users at *@example.com")
    print()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Seed demo data for local development.")
    parser.add_argument(
        "--scale",
        type=int,
        default=1,
        help="Multiplier for record counts (default 1 = ~215 records).",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Delete demo users (and their cascaded data) before seeding.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print counts without inserting.",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="RNG seed (default 42 — deterministic).",
    )
    parser.add_argument(
        "--avatar",
        choices=["local", "external"],
        default="local",
        help=(
            "local (default) — write PNGs to MEDIA_ROOT and set "
            "avatar_url=/media/avatars/{uid}.png. "
            "external — set avatar_url to https://ui-avatars.com/... ."
        ),
    )
    args = parser.parse_args(argv)

    counts = asyncio.run(
        seed(
            scale=args.scale,
            reset=args.reset,
            dry_run=args.dry_run,
            rng_seed=args.seed,
            avatar_mode=args.avatar,
        )
    )
    if counts:
        _summarize(counts, args.scale, Path(get_settings().media_root))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
