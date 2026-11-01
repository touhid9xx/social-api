"""Real-photograph sourcing for `scripts/seed_demo_data.py`.

Why this module exists
----------------------
The seed used to paint every avatar and every gallery tile with a generated
solid-colour PNG. That rendered without a 404, but a demo populated with flat
squares looks broken and makes screenshots useless.

This module fetches *actual photographs* instead:

* portraits -- ``randomuser.me/api/portraits/{men,women}/{n}.jpg``. 100
  distinct, real, CC-licensed portrait photographs per gender behind a stable
  path, so a seed stays reproducible without vendoring image binaries.
* photos -- ``picsum.photos/seed/{seed}/{w}/{h}``, which serves real
  photographs (a curated Unsplash set) at deterministic per-seed URLs.

Both are content-cached on disk, so re-seeding is offline and instant.

Failure policy
--------------
Seeding must never hard-fail because a laptop is offline or a CDN is rate
limiting. Every fetch takes a ``fallback`` callable supplied by the caller (the
legacy generated PNG): if the download fails, the fallback bytes are used and
the caller behaves exactly as before. Passing ``mode="placeholder"`` skips the
network entirely.
"""

from __future__ import annotations

import hashlib
import tempfile
import urllib.error
import urllib.request
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

__all__ = [
    "PHOTO_MODES",
    "PhotoAsset",
    "PhotoFetcher",
    "ext_of",
    "mime_of",
    "photo_url",
    "portrait_url",
]

PHOTO_MODES = ("real", "placeholder")

_PORTRAIT_BASE = "https://randomuser.me/api/portraits"
_PHOTO_BASE = "https://picsum.photos"

# randomuser.me ships 0-99 per gender; wrap so any user count works.
_PORTRAIT_VARIANTS = 100
# Start past 0-9: those are the same handful of faces every tutorial uses.
_PORTRAIT_FIRST = 11

_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
_JPEG_MAGIC = b"\xff\xd8\xff"

_USER_AGENT = "social-api-seed/2.0 (local development seeding)"
# Anything smaller is a truncated response or an HTML error page, not a photo.
_MIN_PLAUSIBLE_BYTES = 512


def portrait_url(index: int) -> str:
    """Return a distinct real portrait URL for a 0-based *index*.

    Gender alternates so a mixed cast emerges naturally, and the per-gender
    counter advances every second index so no two of the first 200 users share
    a face.
    """
    gender = "women" if index % 2 else "men"
    number = (_PORTRAIT_FIRST + index // 2) % _PORTRAIT_VARIANTS
    return f"{_PORTRAIT_BASE}/{gender}/{number}.jpg"


def photo_url(seed: str, width: int = 900, height: int = 900) -> str:
    """Return a deterministic real-photo URL for an arbitrary *seed* string."""
    return f"{_PHOTO_BASE}/seed/{seed}/{width}/{height}"


def ext_of(data: bytes) -> str:
    """Sniff the file extension from the image's magic bytes."""
    if data.startswith(_JPEG_MAGIC):
        return "jpg"
    return "png"


def mime_of(ext: str) -> str:
    """Map a sniffed extension to its MIME type."""
    return "image/jpeg" if ext == "jpg" else "image/png"


@dataclass(frozen=True)
class PhotoAsset:
    """One stored image: where it lives plus the bytes that produced it."""

    storage_key: str
    data: bytes
    ext: str
    written: bool

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.data).hexdigest()

    @property
    def mime(self) -> str:
        return mime_of(self.ext)

    @property
    def size(self) -> int:
        return len(self.data)


class PhotoFetcher:
    """Download-and-cache real photographs, with a per-URL fallback.

    Not thread-safe by design; `prefetch` only uses threads to warm the cache,
    and every thread writes disjoint cache keys.
    """

    def __init__(
        self,
        *,
        mode: str = "real",
        cache_dir: Path | None = None,
        timeout: float = 25.0,
        workers: int = 8,
    ) -> None:
        if mode not in PHOTO_MODES:
            raise ValueError(f"mode must be one of {PHOTO_MODES}, got {mode!r}")
        self.mode = mode
        self.cache_dir = cache_dir or Path(tempfile.gettempdir()) / "social-seed-photos"
        self.timeout = timeout
        self.workers = workers
        self.downloaded = 0
        self.cached = 0
        self._memo: dict[str, bytes] = {}
        self._failed: set[str] = set()

    # -- cache ---------------------------------------------------------------
    def _cache_path(self, url: str) -> Path:
        digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:32]
        return self.cache_dir / f"{digest}.img"

    def _load(self, url: str) -> bytes | None:
        try:
            data = self._cache_path(url).read_bytes()
        except OSError:
            return None
        return data if _plausible(data) else None

    def _store(self, url: str, data: bytes) -> None:
        # The cache is an optimisation, never a requirement: a read-only or
        # full disk must not fail the seed.
        try:
            path = self._cache_path(url)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        except OSError:
            pass

    # -- network -------------------------------------------------------------
    def _download(self, url: str) -> bytes | None:
        if self.mode != "real" or not url.startswith(("http://", "https://")):
            return None
        request = urllib.request.Request(  # noqa: S310 — scheme checked above
            url, headers={"User-Agent": _USER_AGENT}
        )
        try:
            # Scheme is constrained to http(s) immediately above.
            with urllib.request.urlopen(request, timeout=self.timeout) as response:  # noqa: S310
                data: bytes = response.read()
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
            self._fail(url, exc)
            return None
        if not _plausible(data):
            self._fail(url, "implausible payload")
            return None
        return data

    def _fail(self, url: str, reason: object) -> None:
        if url not in self._failed:
            self._failed.add(url)
            print(f"   !! photo fetch failed ({reason}) — using generated PNG: {url}")

    # -- public API ----------------------------------------------------------
    def prefetch(self, urls: Iterable[str]) -> None:
        """Warm the cache for *urls* in parallel. Never raises."""
        if self.mode != "real":
            return
        wanted = [url for url in dict.fromkeys(urls) if self._load(url) is None]
        if not wanted:
            return
        print(f"   photos: downloading {len(wanted)} images (cached after the first run)")
        with ThreadPoolExecutor(max_workers=self.workers) as pool:
            list(pool.map(self._warm, wanted))

    def _warm(self, url: str) -> None:
        if url in self._failed or self._load(url) is not None:
            return
        data = self._download(url)
        if data is not None:
            self.downloaded += 1
            self._store(url, data)

    def get(self, url: str, *, fallback: Callable[[], bytes]) -> tuple[bytes, str]:
        """Return ``(bytes, extension)`` for *url*, or the fallback on failure."""
        memo = self._memo.get(url)
        if memo is not None:
            return memo, ext_of(memo)

        cached = self._load(url)
        if cached is not None:
            self.cached += 1
            self._memo[url] = cached
            return cached, ext_of(cached)

        if url not in self._failed:
            fresh = self._download(url)
            if fresh is not None:
                self.downloaded += 1
                self._store(url, fresh)
                self._memo[url] = fresh
                return fresh, ext_of(fresh)

        data = fallback()
        return data, ext_of(data)

    @property
    def failed(self) -> int:
        return len(self._failed)

    def summary(self) -> str:
        return f"downloaded={self.downloaded} cached={self.cached} failed={self.failed}"


def _plausible(data: bytes) -> bool:
    return len(data) >= _MIN_PLAUSIBLE_BYTES and data.startswith((_PNG_MAGIC, _JPEG_MAGIC))
