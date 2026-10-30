# API Contract - Social API

**Version:** `0.1.0`  
**Generated from commit:** `fd185b28dc23` on 2026-10-30T23:11:16.549874+00:00

---

## Quick start

| Artifact | Use it for |
|---|---|
| `openapi.json` | Code generation (openapi-typescript, openapi-generator) |
| `api_reference.md` | Human-readable per-endpoint documentation |
| `api_reference.xlsx` | Spreadsheet review with backend/PM |
| `types.ts` | Direct import of TypeScript types |
| `README.md` | How to consume this bundle |

## Base URL

`http://localhost:8000/api/v1` (dev)

## Authentication

All authenticated endpoints require:

```
Authorization: Bearer <access_token>
```

Get a token via `POST /api/v1/auth/login` (returns `{tokens: {access_token, refresh_token}, user: {...}}`).

Access token lifetime: 15 minutes. Refresh via `POST /api/v1/auth/refresh`.

## Error envelope

All errors (4xx/5xx) share one JSON shape:

```json
{
  "error": "POST_NOT_FOUND",
  "status": 404,
  "detail": "Post not found",
  "path": "/api/v1/posts/123",
  "request_id": "8b6e3cf1-..."
}
```

The `request_id` matches the `X-Request-ID` response header - include it when reporting bugs.

## Response headers

Every response includes:

- `X-Request-ID` - unique per request
- `X-Process-Time-Ms` - server-side processing duration

## Cursor pagination

List endpoints use cursor pagination, not OFFSET:

```
GET /api/v1/posts?limit=20&cursor=<opaque>
```

`response.next_cursor` is a stable opaque token - pass it back unchanged to fetch the next page. `next_cursor: null` means end of data.

## Rate limits

Endpoints with `x-rate-limit` metadata enforce per-IP or per-user limits. 429 responses include a `Retry-After` header (seconds).

## Idempotency

Write endpoints that accept `Idempotency-Key: <uuid>` will:

- **First call**: execute normally
- **Replay (same key, same body)**: return the cached response with `Idempotent-Replay: true` header
- **Conflict (same key, different body)**: 409 `IDEMPOTENCY_KEY_CONFLICT`

Replays are safe to retry - the underlying resource is not created twice.
