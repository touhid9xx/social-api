"""Application configuration via pydantic-settings."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All runtime configuration. Values come from env / .env."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- App ---
    app_name: str = "Social API"
    app_env: Literal["development", "staging", "production"] = "development"
    app_debug: bool = True
    app_host: str = "0.0.0.0"  # noqa: S104  # nosec B104
    app_port: int = 8000
    app_base_url: str = "http://localhost:8000"
    api_v1_prefix: str = "/api/v1"
    default_locale: str = "en"
    supported_locales: str = "en,bn"

    # --- Security ---
    jwt_algorithm: str = "RS256"
    jwt_private_key_path: str = "./secrets/jwt_private.pem"
    jwt_public_key_path: str = "./secrets/jwt_public.pem"
    jwt_access_ttl_seconds: int = 900
    jwt_refresh_ttl_seconds: int = 604_800
    jwt_issuer: str = "social-api"
    jwt_audience: str = "social-api-clients"
    encryption_key: str = Field(default="", description="Fernet base64 key")

    # --- DB ---
    mysql_host: str = "127.0.0.1"
    mysql_port: int = 3306
    mysql_user: str = "social"
    mysql_password: str = "socialpass"  # noqa: S105  # nosec B105
    mysql_db: str = "social"
    database_url: str = "mysql+asyncmy://social:socialpass@127.0.0.1:3307/social?charset=utf8mb4"

    # --- Redis ---
    redis_url: str = "redis://127.0.0.1:6379/0"
    redis_celery_url: str = "redis://127.0.0.1:6379/1"

    # --- Celery ---
    celery_broker_url: str = "redis://127.0.0.1:6379/1"
    celery_result_backend: str = "redis://127.0.0.1:6379/2"
    celery_task_always_eager: bool = False

    # --- Media ---
    media_root: str = "./data/media"
    media_max_image_bytes: int = 10 * 1024 * 1024
    media_max_video_bytes: int = 100 * 1024 * 1024
    skip_virus_scan: bool = True

    # --- Email ---
    smtp_host: str = "127.0.0.1"
    smtp_port: int = 1025
    smtp_from: str = "noreply@social.local"
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_tls: bool = False

    # --- Observability ---
    log_level: str = "DEBUG"
    log_format: Literal["console", "json"] = "console"
    otel_enabled: bool = False
    otel_service_name: str = "social-api"
    otel_exporter_otlp_endpoint: str = "http://127.0.0.1:4317"

    # --- Rate limit ---
    rate_limit_enabled: bool = True

    # --- Feature flags ---
    ff_ws_enabled: bool = True
    ff_chat_enabled: bool = True
    ff_gdpr_enabled: bool = True
    ff_feed_fanout_enabled: bool = False

    # --- CORS ---
    cors_origins: str = "http://localhost:3000,http://localhost:5173"

    # --- Derived helpers (properties) ---
    @property
    def supported_locales_list(self) -> list[str]:
        return [s.strip() for s in self.supported_locales.split(",") if s.strip()]

    @property
    def cors_origins_list(self) -> list[str]:
        return [s.strip() for s in self.cors_origins.split(",") if s.strip()]

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def media_root_path(self) -> Path:
        p = Path(self.media_root)
        p.mkdir(parents=True, exist_ok=True)
        return p

    @field_validator("log_level")
    @classmethod
    def _validate_log_level(cls, v: str) -> str:
        allowed = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
        v_up = v.upper()
        if v_up not in allowed:
            raise ValueError(f"log_level must be one of {allowed}")
        return v_up


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached settings instance (one per process)."""
    return Settings()
