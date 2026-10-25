"""Trending score computation."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from social_api.workers.tasks.trending import compute_trending_score

pytestmark = pytest.mark.unit

NOW = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)


def _score(likes: int, comments: int, age_hours: float) -> float:
    return compute_trending_score(
        like_count=likes,
        comment_count=comments,
        created_at=NOW - timedelta(hours=age_hours),
        now=NOW,
    )


def test_fresh_post_with_zero_engagement_is_zero() -> None:
    assert _score(0, 0, 0) == 0.0


def test_likes_and_comments_add_weighted() -> None:
    # 10 likes -> 20; 10 comments -> 30; total 50; age 0 -> 50 / 2^1.5
    s = _score(10, 10, 0)
    expected = 50 / (2**1.5)
    assert abs(s - expected) < 1e-9


def test_gravity_decays_with_age() -> None:
    fresh = _score(10, 5, 0)
    aged = _score(10, 5, 24)
    assert fresh > aged
    assert aged / fresh < 0.1  # strong decay


def test_comment_weighs_more_than_like() -> None:
    one_like = _score(1, 0, 0)
    one_comment = _score(0, 1, 0)
    assert one_comment > one_like
    assert one_comment / one_like == pytest.approx(1.5)


def test_negative_age_clamped_to_zero() -> None:
    # created_at in the future (clock skew) -> age_hours = 0
    future = compute_trending_score(
        like_count=5,
        comment_count=5,
        created_at=NOW + timedelta(hours=1),
        now=NOW,
    )
    same_as_now = compute_trending_score(
        like_count=5,
        comment_count=5,
        created_at=NOW,
        now=NOW,
    )
    assert future == same_as_now


def test_48h_post_needs_much_more_engagement() -> None:
    # 48h-old post with same engagement -> tiny fraction of fresh
    fresh = _score(10, 10, 0)
    old = _score(10, 10, 48)
    assert fresh > old * 100
