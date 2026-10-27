from __future__ import annotations

from typing import Any

import anyio

from social_api.logging_config import get_logger
from social_api.media.storage import StoredObject

logger = get_logger(__name__)


class S3Storage:
    """..."""

    def __init__(
        self,
        *,
        bucket: str,
        region: str,
        prefix: str = "",
        presign_ttl: int = 3600,
    ) -> None:
        try:
            import boto3
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("S3Storage requires boto3. Install with: pip install boto3") from exc

        self._bucket = bucket
        self._prefix = prefix.rstrip("/")
        self._presign_ttl = presign_ttl
        # boto3-stubs' client() overload resolution has a known bug where
        # Pylance picks a mismatched Literal overload. Cast to Any to bypass
        # (runtime is correct; boto3.client("s3") always returns an S3 client).
        self._client: Any = boto3.client("s3", region_name=region)

    def _key(self, key: str) -> str:
        return f"{self._prefix}/{key}" if self._prefix else key

    async def put(self, *, key: str, data: bytes, content_type: str) -> StoredObject:
        from social_api.core.circuit_breakers import s3_breaker

        async def _do() -> StoredObject:
            full = self._key(key)
            await anyio.to_thread.run_sync(
                lambda: self._client.put_object(
                    Bucket=self._bucket, Key=full, Body=data, ContentType=content_type
                )
            )
            return StoredObject(key=key, size_bytes=len(data), url=await self.url_for(key=key))

        return await s3_breaker.call(_do)

    async def delete(self, *, key: str) -> None:
        full = self._key(key)
        await anyio.to_thread.run_sync(
            lambda: self._client.delete_object(Bucket=self._bucket, Key=full)
        )

    async def url_for(self, *, key: str) -> str:
        full = self._key(key)
        url: str = await anyio.to_thread.run_sync(
            lambda: self._client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self._bucket, "Key": full},
                ExpiresIn=self._presign_ttl,
            )
        )
        return url
