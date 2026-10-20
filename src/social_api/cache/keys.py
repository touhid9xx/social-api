"""Centralized Redis key naming. Never inline keys elsewhere."""

from __future__ import annotations


class RedisKeys:
    """Namespaced key builders."""

    @staticmethod
    def user_session(user_id: int) -> str:
        return f"session:user:{user_id}"

    @staticmethod
    def jwt_blacklist(jti: str) -> str:
        return f"jwt:blacklist:{jti}"

    @staticmethod
    def rate_limit(scope: str, ident: str) -> str:
        return f"rl:{scope}:{ident}"

    @staticmethod
    def feed_home(user_id: int) -> str:
        return f"feed:home:{user_id}"

    @staticmethod
    def explore_zset() -> str:
        return "feed:explore:zset"

    @staticmethod
    def presence(user_id: int) -> str:
        return f"presence:user:{user_id}"

    @staticmethod
    def idempotency(key: str) -> str:
        return f"idem:{key}"
