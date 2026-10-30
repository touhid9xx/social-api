# ADR-007: Dual feature flag providers (sync env + async chained)

**Status:** Accepted

## Context

Feature flags gate risky features:
- `ws_enabled` — WebSocket + realtime notifications.
- `chat_enabled` — chat feature.
- `gdpr_enabled` — data export + deletion flows.
- `feed_fanout_enabled` — hybrid fanout (M10).

Requirements:
1. **Env-based default** — dev/prod differentiation via env vars.
2. **Per-user override** — can enable a feature for specific testers.
3. **No coupling to Redis** — flag check shouldn't fail if Redis is down.
4. **Migration path** — eventually adopt Unleash/LaunchDarkly.

Existing code (M9–M13) calls `get_flags().is_enabled("flag_name")` —
**synchronous** API, no user context.

The per-user override feature needs async (Redis lookup) + user context.

## Decision

**Two providers coexist:**

### `core/feature_flags.py` (legacy, sync)
```python
def get_flags() -> SyncFlagProvider
flags.is_enabled("ws_enabled")  # sync, env-only
