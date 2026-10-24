"""MIME + size validation via filetype (magic bytes, not extension)."""

from __future__ import annotations

from dataclasses import dataclass

import filetype

from social_api.config import get_settings


@dataclass(frozen=True)
class FileValidation:
    mime: str
    kind: str  # "image" | "video"
    ext: str  # canonical extension (lowercase, no dot)


class UnsupportedFileTypeError(ValueError):
    """Raised when a file's MIME type is not allowed."""


class FileTooLargeError(ValueError):
    """Raised when a file exceeds its size limit."""


# extension mapping — canonical
_MIME_TO_EXT: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
}

_IMAGE_MIMES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
_VIDEO_MIMES = {"video/mp4", "video/webm"}


def detect_mime(data: bytes) -> str | None:
    """Detect MIME type by inspecting the first few magic bytes."""
    kind = filetype.guess(data)
    return kind.mime if kind else None


def validate_file(
    *,
    data: bytes,
    declared_content_type: str | None = None,
) -> FileValidation:
    """
    Validate file size + MIME type.

    Detection: magic bytes only. `declared_content_type` is used only as
    a secondary sanity check — a mismatch is ignored (client can lie;
    magic bytes cannot).
    """
    settings = get_settings()
    size = len(data)

    # Sniff first, then decide size limit by kind.
    detected = detect_mime(data)

    if detected not in _MIME_TO_EXT:
        raise UnsupportedFileTypeError(
            f"Unsupported file type: {detected}. Allowed: {sorted(_MIME_TO_EXT)}"
        )

    kind = "image" if detected in _IMAGE_MIMES else "video"
    limit = settings.media_max_image_bytes if kind == "image" else settings.media_max_video_bytes
    if size > limit:
        raise FileTooLargeError(f"{kind.capitalize()} too large: {size} bytes (limit {limit})")

    return FileValidation(mime=detected, kind=kind, ext=_MIME_TO_EXT[detected])
