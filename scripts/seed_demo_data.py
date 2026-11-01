"""Seed demo data for local development and frontend testing.

Deterministic, idempotent, transactional. Writes real photographs (see
`scripts/seed_photos.py`: portraits from randomuser.me, imagery from the
Unsplash-backed picsum.photos) to MEDIA_ROOT, so <img src> shows actual people
and places instead of flat generated squares. If the network is unavailable the
generated PNGs are used instead and the seed still succeeds.

Every demo user also gets their own photo posts (see
`GALLERY_PHOTOS_PER_USER`), so a signed-in visitor who explores other
people finds non-empty feeds AND non-empty galleries — an image-bearing
post is what `/profile/{id}/gallery` derives its tiles from.

Usage:
    python scripts/seed_demo_data.py                 # seed everything
    python scripts/seed_demo_data.py --reset         # delete demo users first
    python scripts/seed_demo_data.py --dry-run       # count-only, no insert
    python scripts/seed_demo_data.py --seed 0        # non-deterministic

Exact per-table totals are printed on completion — they are not duplicated in
this docstring, where they would only ever drift.

Image modes:
    --photos real          (default) — download real photographs (see
                                       scripts/seed_photos.py) and cache them
                                       under --photo-cache
    --photos placeholder   — skip the network; write generated PNGs (offline)
    --avatar local         (default) — store the avatar in MEDIA_ROOT and set
                                       avatar_url=/static/media/avatars/...
    --avatar external      — set avatar_url to a public UI Avatars URL
                                       Use when MEDIA_ROOT is not served

Demo credentials (all users, password `DemoPass123!`):
    admin@example.com     (admin)
    mod@example.com       (moderator)
    alice@example.com     (celebrity, everyone follows her)
    bob@example.com
    carol@example.com
    ... 25 more accounts, for 30 people in total
    tushar@tushar.com     (admin) — non-@example.com account, so the seeded
                                    domain is not assumed to be uniform
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
# ROOT itself, so `scripts.seed_photos` resolves whether this file is run as a
# script (python scripts/seed_demo_data.py) or imported as a module.
sys.path.insert(0, str(ROOT))

from sqlalchemy import delete, select  # noqa: E402

from scripts import seed_photos  # noqa: E402
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
    # 5 named + 25 numbered = 30 people on the canonical @example.com domain.
    *[f"user{i:02d}@example.com" for i in range(1, 26)],
    # Appended, never inserted: fixtures below address demo users positionally
    # (`users[:15]`, `_admin, mod, alice, bob, carol = users[:5]`), so a new
    # account must go last or every one of those indices shifts.
    "tushar@tushar.com",
]

# Additional admin accounts, listed by address rather than by index so that
# appending to DEMO_EMAILS above stays safe.
EXTRA_ADMIN_EMAILS = frozenset({"tushar@tushar.com"})

# Display names for the 25 numbered accounts (DEMO_EMAILS[5:30]), in the same
# order. Plain "User 07" next to a real photographic portrait reads as broken
# demo data, so the numbered accounts get ordinary human names; the address is
# still userNN@example.com, which is what keeps them predictable for testing.
DISPLAY_NAMES = [
    "Tanvir Ahmed",
    "Nusrat Jahan",
    "Arif Hossain",
    "Sadia Islam",
    "Rafiq Chowdhury",
    "Mehjabin Karim",
    "Imran Sheikh",
    "Farhana Akter",
    "Shakib Rahman",
    "Tasnim Bushra",
    "Delwar Hossain",
    "Rubina Sultana",
    "Nayeem Uddin",
    "Anika Tabassum",
    "Sohel Rana",
    "Jarin Tasnim",
    "Mahmudul Hasan",
    "Sharmin Sultana",
    "Asif Mahmud",
    "Rumana Begum",
    "Fahim Reza",
    "Nadia Sharmin",
    "Zahid Hasan",
    "Mitu Das",
    "Hasib Rahman",
]

# Public image posts created per demo user. `/profile/{id}/gallery` derives its
# tiles from the author's posts that carry media, so this is what keeps every
# demo profile's gallery non-empty (and the explore feed image-rich).
GALLERY_PHOTOS_PER_USER = 3

# Record counts. Module-level so the pre-download list and the insert loops are
# driven by the same numbers and cannot drift apart.
N_POSTS = 90
N_TOP_COMMENTS = 60
N_REPLY_COMMENTS = 30
N_POST_LIKES = 300
N_COMMENT_LIKES = 90
N_POST_PHOTOS = 18
N_ORPHAN_PHOTOS = 8
N_MESSAGES = 40
N_NOTIFICATIONS_PER_KIND = 20


# Replaced by main() with the fetcher configured from --photos/--photo-cache.
# The placeholder default keeps importers (and --dry-run) off the network.
_photos: seed_photos.PhotoFetcher = seed_photos.PhotoFetcher(mode="placeholder")


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

    The color alone is NOT unique per seed: ``seed * k % 256`` repeats
    every 256 seeds, so two different seeds 256 apart render identical
    pixels. The media table has a unique ``(owner_id, sha256)``
    constraint, so the seed is also embedded verbatim in a ``tEXt``
    chunk (ignored by renderers, part of the hashed bytes) to keep the
    mapping seed -> bytes injective. Without this, a user owning media
    from two seed ranges (e.g. a post image at seed 1000 and gallery
    images at seed 4840) hits that constraint.
    """
    r = (seed * 67) % 256
    g = (seed * 131) % 256
    b = (seed * 197) % 256

    def _chunk(tag: bytes, data: bytes) -> bytes:
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit RGB
    seed_text = _chunk(b"tEXt", b"Seed\x00" + str(seed).encode("ascii"))
    row = b"\x00" + bytes([r, g, b]) * size
    idat = zlib.compress(row * size, 9)
    return sig + _chunk(b"IHDR", ihdr) + seed_text + _chunk(b"IDAT", idat) + _chunk(b"IEND", b"")


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


def _photo_asset(
    url: str,
    *,
    folder: str,
    media_root: Path,
    fallback_seed: int,
    fallback_size: int = 512,
) -> seed_photos.PhotoAsset:
    """Fetch *url* (real photograph) and store it under MEDIA_ROOT/*folder*.

    The returned asset owns the extension, MIME type, size and sha256 of the
    bytes that were actually written — the caller must use those instead of
    assuming PNG, because a successful download is usually JPEG.

    The `fallback` is the legacy generated PNG, so an offline laptop still seeds.
    """
    data, ext = _photos.get(
        url,
        fallback=lambda: _generate_png(seed=fallback_seed, size=fallback_size),
    )
    sha = hashlib.sha256(data).hexdigest()
    storage_key = f"{folder}/{sha[:16]}.{ext}"
    written = _write_media_file(media_root, storage_key, data)
    return seed_photos.PhotoAsset(storage_key=storage_key, data=data, ext=ext, written=written)


def _image_urls(users: list[User]) -> list[str]:
    """Every image URL this seed will need, as one list.

    Built up front so `PhotoFetcher.prefetch` can warm the cache in parallel
    instead of stalling on one synchronous download per insert. The URL seeds
    must match the ones the insert loops below use, and they do because both
    read the same module-level counts.
    """
    urls = [seed_photos.portrait_url(i) for i in range(len(users))]
    urls += [seed_photos.photo_url(f"post-{i}") for i in range(N_POST_PHOTOS)]
    urls += [seed_photos.photo_url(f"orphan-{i}", 800, 800) for i in range(N_ORPHAN_PHOTOS)]
    urls += [
        seed_photos.photo_url(f"gallery-{u.id}-{j}")
        for u in users
        for j in range(GALLERY_PHOTOS_PER_USER)
    ]
    urls += [seed_photos.photo_url(f"chat-{i}", 800, 800) for i in range(2)]
    return urls


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
            await session.execute(select(User).where(User.email_hash == hash_email(DEMO_EMAILS[0])))
        ).scalar_one_or_none()
        if existing is not None:
            print(">> [skip] demo data already present. Use --reset to re-seed.")
            return counts

        if dry_run:
            print(">> [dry-run] would seed users, galleries and media; no changes made.")
            return counts

        # =====================================================================
        # 1. Users (21)
        # =====================================================================
        pw_hash = hash_password(DEMO_PASSWORD)
        users: list[User] = []

        role_map = [
            (DEMO_EMAILS[0], UserRole.ADMIN),
            (DEMO_EMAILS[1], UserRole.MODERATOR),
            *[
                (e, UserRole.ADMIN if e in EXTRA_ADMIN_EMAILS else UserRole.USER)
                for e in DEMO_EMAILS[2:]
            ],
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
        print(f"[ 1/17] users: {len(users)}")

        # =====================================================================
        # 2. Profiles (1 per user) — stores a real portrait (local mode)
        # =====================================================================
        names = [
            "Admin",
            "Mod",
            "Alice Rahman",
            "Bob Carter",
            "Carol Mendes",
            *DISPLAY_NAMES,  # 25 people, index-aligned with DEMO_EMAILS[5:30]
            "Tushar",  # must stay index-aligned with DEMO_EMAILS (zip strict=True)
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
        profiles: list[Profile] = []
        # Warm the whole image cache in parallel before the (sequential) insert
        # loops: every URL the seed will need, fetched once up front. Portraits
        # are indexed by cast position so no two demo users share a face.
        _photos.prefetch(_image_urls(users))
        for index, (u, name) in enumerate(zip(users, names, strict=True)):
            if avatar_mode == "local":
                avatar = _photo_asset(
                    seed_photos.portrait_url(index),
                    folder="avatars",
                    media_root=media_root,
                    fallback_seed=u.id,
                    fallback_size=128,
                )
                if avatar.written:
                    avatars_written += 1
                avatar_url_value = f"/static/media/{avatar.storage_key}"
            else:
                avatar_url_value = (
                    f"https://ui-avatars.com/api/?name={name.replace(' ', '+')}&size=128"
                )

            profile = Profile(
                user_id=u.id,
                display_name=name,
                bio=rng.choice(bios),
                avatar_url=avatar_url_value,
                location=rng.choice(["Dhaka", "London", "Berlin", None]),
                website=rng.choice(["https://example.com", None]),
                visibility=rng.choice([Visibility.PUBLIC, Visibility.PUBLIC, Visibility.FOLLOWERS]),
                pii_visibility=Visibility.PRIVATE,
                dob=rng.choice(["1990-05-15", None]),
                phone=rng.choice(["+8801700000000", None]),
                created_at=u.created_at,
            )
            session.add(profile)
            profiles.append(profile)
            bump("profiles")
        await session.flush()
        print(f"[ 2/17] profiles: {counts['profiles']} (avatars written: {avatars_written})")

        # =====================================================================
        # 3. Consents
        # =====================================================================
        for u in users[:25]:
            for ch in rng.sample(list(ConsentChannel), k=rng.randint(1, 3)):
                granted = rng.random() < 0.7
                consent = UserConsent(
                    user_id=u.id,
                    channel=ch,
                    granted=granted,
                    granted_at=u.created_at,
                    revoked_at=(
                        None if granted else u.created_at + timedelta(days=rng.randint(1, 10))
                    ),
                    ip="127.0.0.1",
                    user_agent="seed-script",
                    created_at=u.created_at,
                )
                session.add(consent)
                bump("user_consent")
        await session.flush()
        print(f"[ 3/17] user_consent: {counts['user_consent']}")

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
        print(f"[ 4/17] follows: {counts['follows']}")

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
        print(f"[ 5/17] blocks+mutes: {counts['blocks']}+{counts['mutes']}")

        # =====================================================================
        # 6. Posts (N_POSTS)
        # =====================================================================
        # Two pools combined, so ~N_POSTS posts read as a real timeline instead
        # of the same sentence repeated with a counter bolted on.
        post_openers = [
            "Shipped the new feed pipeline today",
            "Coffee at 6am, code by 7",
            "Golden hour on the rooftop",
            "Finally fixed that flaky test",
            "Road trip, no plan, no signal",
            "Reading about keyset pagination again",
            "The cat has claimed the keyboard",
            "Trying a new recipe tonight",
            "Long walk by the river",
            "Refactored a 600-line function",
            "Rain all afternoon",
            "New lens arrived",
            "Someone explain this stack trace to me",
            "Weekend reset",
            "Monday, again",
            "Cleaned up the backlog",
            "This view never gets old",
            "Deep work, four hours, no notifications",
            "Sold my old bike",
            "Sunrise run",
            "Bookstore haul",
            "Late night deploy, all green",
            "Learning the hard way why cursors beat offsets",
            "Slow morning, strong coffee",
            "City lights after the rain",
            "Deleted 3k lines and everything got faster",
            "Home cooked dinner",
            "Chasing bugs in the dark theme",
            "First surf lesson",
            "Shipping small, shipping often",
            "The quietest Sunday",
            "Museum afternoon",
            "Reading list is out of control",
            "New office chair, new posture",
            "Watched the storm roll in",
            "Finally understand the fan-out model",
        ]
        post_tails = [
            "",
            "",
            "",
            "Small win.",
            "Worth the detour.",
            "Still not sure it was the right call.",
            "Would do again.",
            "Now on to the next thing.",
            "Thanks for the recommendations.",
            "Might write it up.",
            "Slowly getting there.",
            "Three rewrites in, and it finally clicks.",
        ]
        # Comment / chat copy. Same reasoning as the post pools above: a list
        # of "top comment 7" placeholders makes every thread look like a
        # fixture, which is exactly what this seed is trying to avoid.
        comment_bodies = [
            "This is the best thing I've read today.",
            "Same here — took me three attempts.",
            "Where was this taken?",
            "That light is unreal.",
            "Congrats! Big step.",
            "Have you tried profiling it first?",
            "Beautiful. Saving this one.",
            "I hit the exact same bug last week.",
            "Tell me you wrote a blog post about it.",
            "Coffee is doing a lot of work in this photo.",
            "Never gets old, does it?",
            "Adding this to my list.",
            "Looks like a proper Sunday.",
            "The colours!",
            "Careful, that's how the rabbit hole starts.",
            "Proud of you.",
            "What lens?",
            "Strongly agree.",
        ]
        reply_bodies = [
            "Totally.",
            "Thanks!",
            "Same to you.",
            "Ha, guilty.",
            "Not yet — good idea.",
            "It was in Lisbon.",
            "Appreciate it!",
            "Will do.",
            "Honestly, yes.",
            "Right?",
        ]
        chat_bodies = [
            "Hey! Long time no see.",
            "Are we still on for tomorrow?",
            "Just sent you the file.",
            "Perfect, thanks!",
            "I'll be there around 7.",
            "Sounds good.",
            "Did you see the game last night?",
            "No way, really?",
            "Let me check and get back to you.",
            "Ha, that's brilliant.",
        ]

        posts: list[Post] = []
        for _ in range(N_POSTS):
            post = Post(
                author_id=rng.choice(users).id,
                body=f"{rng.choice(post_openers)}. {rng.choice(post_tails)}".strip(),
                visibility=rng.choice([Visibility.PUBLIC] * 8 + [Visibility.FOLLOWERS]),
                created_at=_rand_dt(now, 60, rng),
            )
            session.add(post)
            posts.append(post)
            bump("posts")
        # Soft-delete one post (frontend can test "deleted" rendering)
        posts[5].deleted_at = now - timedelta(days=3)
        await session.flush()
        print(f"[ 6/17] posts: {counts['posts']}")

        # =====================================================================
        # 7. Comments (N_TOP_COMMENTS top-level + N_REPLY_COMMENTS depth-2)
        # =====================================================================
        top_comments: list[Comment] = []
        for _ in range(N_TOP_COMMENTS):
            post = rng.choice(posts)
            comment = Comment(
                post_id=post.id,
                author_id=rng.choice(users).id,
                parent_id=None,
                depth=1,
                body=rng.choice(comment_bodies),
                created_at=_rand_dt(now, 55, rng),
            )
            session.add(comment)
            top_comments.append(comment)
            bump("comments")
        await session.flush()

        for _ in range(N_REPLY_COMMENTS):
            parent = rng.choice(top_comments)
            reply = Comment(
                post_id=parent.post_id,
                author_id=rng.choice(users).id,
                parent_id=parent.id,
                depth=2,
                body=rng.choice(reply_bodies),
                created_at=parent.created_at + timedelta(hours=rng.randint(1, 48)),
            )
            session.add(reply)
            bump("comments")
        await session.flush()
        print(f"[ 7/17] comments: {counts['comments']}")

        # =====================================================================
        # 8. Likes (N_POST_LIKES on posts + N_COMMENT_LIKES on comments)
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

        for _ in range(N_POST_LIKES):
            like(rng.choice(users).id, LikeTarget.POST, rng.choice(posts).id)
        for _ in range(N_COMMENT_LIKES):
            like(
                rng.choice(users).id,
                LikeTarget.COMMENT,
                rng.choice(top_comments).id,
            )
        await session.flush()
        print(f"[ 8/17] likes: {counts['likes']}")

        # =====================================================================
        # 9. Media — real photographs attached to posts, plus orphans
        # =====================================================================
        # Ownership follows the post's author rather than a random user: a media
        # row owned by someone who does not own the post breaks the ownership
        # checks in MediaService and makes the gallery look inconsistent.
        medias: list[Media] = []
        for i in range(N_POST_PHOTOS):
            post = posts[i % len(posts)]
            asset = _photo_asset(
                seed_photos.photo_url(f"post-{i}"),
                folder="posts",
                media_root=media_root,
                fallback_seed=5000 + i,
            )
            post_media = Media(
                owner_id=post.author_id,
                post_id=post.id,
                message_id=None,
                sha256=asset.sha256,
                mime=asset.mime,
                kind=MediaKind.IMAGE,
                size_bytes=asset.size,
                storage_key=asset.storage_key,
                original_name=f"post-{i}.{asset.ext}",
                created_at=_rand_dt(now, 55, rng),
            )
            session.add(post_media)
            medias.append(post_media)
            bump("media")

        for i in range(N_ORPHAN_PHOTOS):
            owner = rng.choice(users)
            asset = _photo_asset(
                seed_photos.photo_url(f"orphan-{i}", 800, 800),
                folder="orphans",
                media_root=media_root,
                fallback_seed=6000 + i,
            )
            orphan_media = Media(
                owner_id=owner.id,
                post_id=None,
                message_id=None,
                sha256=asset.sha256,
                mime=asset.mime,
                kind=MediaKind.IMAGE,
                size_bytes=asset.size,
                storage_key=asset.storage_key,
                original_name=f"orphan-{i}.{asset.ext}",
                created_at=_rand_dt(now, 55, rng),
            )
            session.add(orphan_media)
            medias.append(orphan_media)
            bump("media")
        await session.flush()
        print(f"[ 9/17] media: {counts['media']}")

        # Set post.media_count from real associations
        post_media_count: dict[int, int] = {}
        for media in medias:
            if media.post_id is not None:
                post_media_count[media.post_id] = post_media_count.get(media.post_id, 0) + 1
        for post in posts:
            post.media_count = post_media_count.get(post.id, 0)
        await session.flush()

        # =====================================================================
        # 10. Galleries — every demo user gets public image posts
        # =====================================================================
        # `/profile/{id}/gallery` derives its tiles from the author's posts that
        # carry media, so a demo account without image posts has an empty
        # gallery and the screen looks broken to whoever signed in to explore.
        # Public visibility is deliberate: these are the images a signed-in
        # visitor is supposed to discover in the explore feed.
        gallery_captions = [
            "golden hour",
            "street lights",
            "new lens test",
            "rooftop view",
            "morning fog",
            "coffee and code",
            "film grain",
            "city walk",
        ]
        gallery_specs: list[tuple[Post, str, int]] = []
        for u in users:
            for j in range(GALLERY_PHOTOS_PER_USER):
                gallery_post = Post(
                    author_id=u.id,
                    body=f"{rng.choice(gallery_captions)} #{u.id:02d}-{j + 1}",
                    visibility=Visibility.PUBLIC,
                    created_at=_rand_dt(now, 60, rng),
                    media_count=1,
                )
                session.add(gallery_post)
                posts.append(gallery_post)
                bump("posts")
                # Seed embeds both the owner and the slot, so the URL (and
                # therefore the image, and therefore the sha256) is distinct for
                # every (user, photo). The media table has a unique
                # (owner_id, sha256) constraint, and one user owns several
                # images across the post/gallery/orphan ranges.
                gallery_specs.append(
                    (
                        gallery_post,
                        seed_photos.photo_url(f"gallery-{u.id}-{j}"),
                        # Distinct fallback seeds too, for the offline path: the
                        # generated PNG embeds its seed, which keeps the bytes —
                        # and so the sha256 — injective per (user, slot).
                        7000 + u.id * 10 + j,
                    )
                )
        await session.flush()

        for gallery_post, gallery_url, fallback_seed in gallery_specs:
            asset = _photo_asset(
                gallery_url,
                folder="gallery",
                media_root=media_root,
                fallback_seed=fallback_seed,
            )
            session.add(
                Media(
                    owner_id=gallery_post.author_id,
                    post_id=gallery_post.id,
                    message_id=None,
                    sha256=asset.sha256,
                    mime=asset.mime,
                    kind=MediaKind.IMAGE,
                    size_bytes=asset.size,
                    storage_key=asset.storage_key,
                    original_name=f"gallery-{gallery_post.id}.{asset.ext}",
                    created_at=gallery_post.created_at,
                )
            )
            bump("media")
        await session.flush()
        print(f"[10/17] galleries: {len(gallery_specs)} images for {len(users)} users")

        # =====================================================================
        # 11. Chat rooms (3 direct + 3 group)
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
        print(f"[11/17] chat_rooms: {counts['chat_rooms']}")

        # =====================================================================
        # 12. Chat room members
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
        print(f"[12/17] chat_room_members: {counts['chat_room_members']}")

        # =====================================================================
        # 13. Messages (N_MESSAGES — the first two carry a photo)
        # =====================================================================
        msgs: list[Message] = []
        message_media: list[Media] = []
        for i in range(N_MESSAGES):
            room = rng.choice(rooms)
            member_ids = (
                (
                    await session.execute(
                        select(ChatRoomMember.user_id).where(ChatRoomMember.room_id == room.id)
                    )
                )
                .scalars()
                .all()
            )
            sender = rng.choice(member_ids)

            # Attach a real photograph to the first 2 messages
            if i < 2:
                asset = _photo_asset(
                    seed_photos.photo_url(f"chat-{i}", 800, 800),
                    folder="messages",
                    media_root=media_root,
                    fallback_seed=8000 + i,
                )
                chat_media = Media(
                    owner_id=sender,
                    post_id=None,
                    message_id=None,
                    sha256=asset.sha256,
                    mime=asset.mime,
                    kind=MediaKind.IMAGE,
                    size_bytes=asset.size,
                    storage_key=asset.storage_key,
                    original_name=f"chat-{i}.{asset.ext}",
                    created_at=_rand_dt(now, 20, rng),
                )
                session.add(chat_media)
                message_media.append(chat_media)
                bump("media")

            msg = Message(
                room_id=room.id,
                sender_id=sender,
                body=rng.choice(chat_bodies),
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
        print(f"[13/17] messages: {counts['messages']}")

        # =====================================================================
        # 14. Notifications (N_NOTIFICATIONS_PER_KIND of each kind)
        # =====================================================================
        seen_n: set[tuple[int, int, str, str, int, date]] = set()
        notifications: list[Notification] = []

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
            note = Notification(
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
            session.add(note)
            notifications.append(note)
            bump("notifications")

        # Follow notifications
        for _ in range(N_NOTIFICATIONS_PER_KIND):
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
        for _ in range(N_NOTIFICATIONS_PER_KIND):
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
        for _ in range(N_NOTIFICATIONS_PER_KIND):
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
        print(f"[14/17] notifications: {counts['notifications']}")

        # =====================================================================
        # 15. Reports (5 — one per status)
        # =====================================================================
        status_cycle = [
            ReportStatus.OPEN,
            ReportStatus.UNDER_REVIEW,
            ReportStatus.RESOLVED,
            ReportStatus.DISMISSED,
            ReportStatus.OPEN,
        ]
        seen_reports: set[tuple[int, str, int, date]] = set()
        reports: list[Report] = []
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
            reports.append(report)
            bump("reports")
        await session.flush()
        print(f"[15/17] reports: {counts['reports']}")

        # =====================================================================
        # 16. Audit log (one row per canonical action)
        # =====================================================================
        # Only canonical actions. The admin audit trail filters by a closed
        # server-side set (modules/audit/router.py::AuditActionLiteral), so a
        # row written with an invented name like "POST_CREATED" is invisible to
        # every option in that dropdown — the demo data would look broken.
        #
        # One row per action, each pointing at a real entity of the matching
        # type and carrying a payload shaped like the one the service really
        # writes, so every filter option in the admin screen returns something
        # recognisable instead of a generic placeholder.
        #
        # `tests/unit/test_audit_filters.py` fails the build if this list and
        # the router literal ever drift apart.
        targets: dict[str, list[int]] = {
            "user": [u.id for u in users],
            "profile": [p.id for p in profiles],
            "post": [p.id for p in posts],
            "comment": [c.id for c in top_comments],
            "message": [m.id for m in msgs],
            "chat_room": [r.id for r in rooms],
            "report": [r.id for r in reports],
            "notification": [n.id for n in notifications],
            "media": [m.id for m in medias],
            # Retention purges point at rows that are gone, so the real worker
            # writes `entity_id=None` — reflected here.
            "audit_log": [],
        }

        # (action, entity, before, after). `None` payloads mirror the write sites
        # that record only that the event happened (REGISTER, LOGIN, ...).
        audit_spec: list[tuple[str, str, dict[str, object] | None, dict[str, object] | None]] = [
            ("REGISTER", "user", None, None),
            ("VERIFY_EMAIL", "user", None, None),
            ("LOGIN", "user", None, None),
            ("LOGOUT", "user", None, None),
            ("PASSWORD_RESET_REQUESTED", "user", None, None),
            ("PASSWORD_RESET_COMPLETED", "user", None, None),
            ("PASSWORD_CHANGED", "user", None, None),
            ("PROFILE_UPDATE", "profile", None, {"fields_changed": ["bio", "location"]}),
            ("CONSENT_GRANTED", "user", None, {"channel": "analytics"}),
            ("CONSENT_REVOKED", "user", None, {"channel": "marketing"}),
            ("USER_SOFT_DELETE", "user", None, None),
            ("DELETE_POST", "post", None, {"deleted_at": "soft"}),
            ("DELETE_COMMENT", "comment", None, {"deleted_at": "soft"}),
            ("BLOCK", "user", None, None),
            ("UNBLOCK", "user", None, None),
            ("MUTE", "user", None, None),
            ("UNMUTE", "user", None, None),
            ("CREATE_CHAT_GROUP", "chat_room", None, {"title": "Weekend plans"}),
            (
                "UPDATE_CHAT_GROUP_TITLE",
                "chat_room",
                {"title": "Weekend plans"},
                {"title": "Weekend plans (2026)"},
            ),
            ("ADD_CHAT_MEMBER", "chat_room", None, {"user_id": 1}),
            ("REMOVE_CHAT_MEMBER", "chat_room", None, {"user_id": 1}),
            ("DELETE_CHAT_MESSAGE", "message", None, {"deleted": True}),
            (
                "MODERATION_STATUS_UPDATE",
                "report",
                {"status": "under_review"},
                {"status": "resolved"},
            ),
            ("GDPR_DELETE_SCHEDULED", "user", None, {"scheduled_hard_delete_at": "2026-02-14"}),
            ("GDPR_DELETE_CANCELLED", "user", None, {"scheduled_hard_delete_at": None}),
            (
                "FEATURE_FLAG_OVERRIDE",
                "user",
                None,
                {"flag": "explore_feed", "enabled": True, "action": "set"},
            ),
            # Written by the retention worker with the system actor.
            ("USER_HARD_DELETED", "user", None, None),
            ("RETENTION_NOTIFICATIONS_PURGED", "notification", None, {"count": 4}),
            ("RETENTION_AUDIT_PURGED", "audit_log", None, {"count": 12}),
            ("RETENTION_ORPHAN_MEDIA_PURGED", "media", None, {"count": 2}),
            ("RETENTION_MESSAGES_PURGED", "message", None, {"count": 7}),
        ]

        # Rows the retention worker writes carry no human actor; inventing one
        # would misreport who did what in a forensic trail.
        system_actions = {
            "USER_HARD_DELETED",
            "RETENTION_NOTIFICATIONS_PURGED",
            "RETENTION_AUDIT_PURGED",
            "RETENTION_ORPHAN_MEDIA_PURGED",
            "RETENTION_MESSAGES_PURGED",
        }
        staff_by_action = {
            "MODERATION_STATUS_UPDATE": mod.id,
            "FEATURE_FLAG_OVERRIDE": next(u.id for u in users if u.role == UserRole.ADMIN),
        }

        for action, entity, before, after in audit_spec:
            pool = targets[entity]
            entity_id = rng.choice(pool) if pool else None
            actor_id = staff_by_action.get(action)
            if actor_id is None and action not in system_actions:
                actor_id = rng.choice(users).id
            audit = AuditLog(
                actor_id=actor_id,
                action=action,
                entity=entity,
                entity_id=entity_id,
                before=before,
                after=after,
                ip="127.0.0.1" if actor_id is not None else None,
                user_agent="seed-script" if actor_id is not None else None,
                request_id=uuid.uuid4().hex if actor_id is not None else None,
                created_at=_rand_dt(now, 30, rng),
            )
            session.add(audit)
            bump("audit_log")
        await session.flush()
        print(f"[16/17] audit_log: {counts['audit_log']}")

        # =====================================================================
        # 17. Commit
        # =====================================================================
        await session.commit()
        print(f"[17/17] committed. total records: {sum(counts.values())}")

    return counts


# =============================================================================
# CLI
# =============================================================================
def _summarize(
    counts: dict[str, int],
    scale: int,
    media_root: Path,
    photo_summary: str | None = None,
) -> None:
    print()
    print("=" * 60)
    print(f"Seed complete (scale={scale})")
    print("=" * 60)
    for k in sorted(counts):
        print(f"  {k:<22} {counts[k]:>5}")
    print(f"  {'TOTAL':<22} {sum(counts.values()):>5}")
    print()
    print(f"Media files written to: {media_root.resolve()}")
    if photo_summary is not None:
        print(f"Photos: {photo_summary}")
    print()
    print("Demo credentials (password: DemoPass123!):")
    for e in DEMO_EMAILS[:5]:
        print(f"  {e}")
    for e in DEMO_EMAILS[5:]:
        if not e.endswith("@example.com"):
            print(f"  {e}")
    at_example = sum(1 for e in DEMO_EMAILS if e.endswith("@example.com"))
    print(f"  ... + {at_example - 5} more users at *@example.com")
    print()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Seed demo data for local development.")
    parser.add_argument(
        "--scale",
        type=int,
        default=1,
        help=(
            "Accepted for compatibility; current record counts are fixed "
            "(the seeded totals are printed on completion)."
        ),
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
            "local (default) — store a real portrait under MEDIA_ROOT and set "
            "avatar_url=/static/media/{key}. "
            "external — set avatar_url to https://ui-avatars.com/... ."
        ),
    )
    parser.add_argument(
        "--photos",
        choices=list(seed_photos.PHOTO_MODES),
        default="real",
        help=(
            "real (default) — download genuine photographs (randomuser.me "
            "portraits, picsum.photos imagery) and cache them on disk. "
            "placeholder — skip the network and paint the legacy generated "
            "PNGs, which works fully offline."
        ),
    )
    parser.add_argument(
        "--photo-cache",
        type=Path,
        default=None,
        help=(
            "Directory for the photo cache (default: a temp dir shared across "
            "runs, so re-seeding is offline and instant)."
        ),
    )
    args = parser.parse_args(argv)

    global _photos
    _photos = seed_photos.PhotoFetcher(mode=args.photos, cache_dir=args.photo_cache)

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
        _summarize(
            counts,
            args.scale,
            Path(get_settings().media_root),
            photo_summary=_photos.summary(),
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
