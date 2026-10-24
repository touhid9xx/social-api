"""Media validators: MIME + size limits."""

from __future__ import annotations

import pytest

from social_api.media.validators import (
    FileTooLargeError,
    UnsupportedFileTypeError,
    validate_file,
)

pytestmark = pytest.mark.unit

# Minimal valid PNG (1x1 pixel)
PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c63000100000005000100"
    "0d0a2db40000000049454e44ae426082"
)

# Minimal valid GIF
GIF_BYTES = bytes.fromhex(
    "47494638396101000100800000ffffff00000021f90401000000002c00000000010001000002024401003b"
)

# Basic MP4 header
MP4_BYTES = b"\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2avc1mp41" + b"\x00" * 100

# GIF masquerading as .jpg — magic bytes win
FAKE = b"not a real image at all"


def test_png_detected() -> None:
    v = validate_file(data=PNG_BYTES)
    assert v.mime == "image/png"
    assert v.kind == "image"
    assert v.ext == "png"


def test_gif_detected() -> None:
    v = validate_file(data=GIF_BYTES)
    assert v.mime == "image/gif"


def test_mp4_detected() -> None:
    v = validate_file(data=MP4_BYTES)
    assert v.kind == "video"
    assert v.ext == "mp4"


def test_unknown_content_rejected() -> None:
    with pytest.raises(UnsupportedFileTypeError):
        validate_file(data=FAKE)


def test_declared_type_ignored_on_mismatch() -> None:
    # magic bytes say PNG, client lied about JPEG — PNG wins
    v = validate_file(data=PNG_BYTES, declared_content_type="image/jpeg")
    assert v.mime == "image/png"


def test_image_too_large(monkeypatch: pytest.MonkeyPatch) -> None:
    from social_api.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("MEDIA_MAX_IMAGE_BYTES", "10")

    with pytest.raises(FileTooLargeError):
        validate_file(data=PNG_BYTES)  # PNG_BYTES > 10 bytes

    get_settings.cache_clear()
