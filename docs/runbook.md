# Runbook

Incident playbook for the Social API service. Structure: **Symptom → Diagnosis → Mitigation → Post-mortem hooks.**

All checks assume you can reach the running stack. Prod commands use `docker compose -f docker-compose.prod.yml`; substitute `kubectl` / cloud equivalents as needed.

## Table of contents

1. [Service unhealthy (health checks fail)](#1-service-unhealthy-health-checks-fail)
2. [High error rate on writes](#2-high-error-rate-on-writes)
3. [Circuit breaker open (Redis degraded)](#3-circuit-breaker-open-redis-degraded)
4. [Celery backlog](#4-celery-backlog)
5. [WebSocket disconnects spike](#5-websocket-disconnects-spike)
6. [DB connection pool exhausted](#6-db-connection-pool-exhausted)
7. [Disk space low](#7-disk-space-low)

---

## 1. Service unhealthy (health checks fail)

**Symptom:** `/health/ready` returns 503; nginx 502s; docker marks `api` unhealthy.

**Diagnosis:**

```bash
# Full status of every container
docker compose -f docker-compose.prod.yml ps

# API readiness (with details of which dependency is down)
curl -sS http://localhost/health/ready | jq .
# Example output:
# {"status": "not_ready",
#  "overall": "down",
#  "checks": {
#    "db":    {"status": "down", "error": "OperationalError", "latency_ms": 5000},
#    "redis": {"status": "ok"}
#  }}

# Per-dependency probes
curl -sS http://localhost/health/db
curl -sS http://localhost/health/redis

# Recent API logs
docker compose -f docker-compose.prod.yml logs --tail=200 api
```

**Mitigation:**

| Which dep is down | Action |
|---|---|
| `db` | Check MySQL container; if OOM/crash, restart it. If data corruption, restore from backup (see post-mortem). |
| `redis` | Restart Redis. App enters degraded mode automatically (DB fallback for feed; rate-limit fails open). |
| neither, but API 503 | App boot failure — check `docker logs api` for traceback; likely a missing env var or migration not applied. |

```bash
# Restart failing dependency
docker compose -f docker-compose.prod.yml restart mysql
docker compose -f docker-compose.prod.yml restart redis

# If API itself is stuck
docker compose -f docker-compose.prod.yml restart api
```

**Post-mortem hooks:**
- Which alert fired first? (`HighErrorRate`? `CircuitBreakerOpen`? `DBPoolExhausted`?)
- Was there a slow query before the outage?
- Was there a deployment in the last hour? (`docker image ls social-api` timestamps)

---

## 2. High error rate on writes

**Symptom:** `HighErrorRate` alert fires (5xx > 1% for 5m). Reads may be fine; writes fail.

**Diagnosis:**

```bash
# Which paths are failing?
curl -sS http://localhost/metrics | grep 'http_requests_total{.*5..}'
# Example:
# http_requests_total{method="POST",path="/api/v1/posts",status="503"} 47

# Check breaker state
curl -sS http://localhost/health/circuit-breakers | jq .  # admin only

# Check rate-limit hits
curl -sS http://localhost/metrics | grep rate_limit_hits_total

# Check DB health
curl -sS http://localhost/health/db | jq .
```

**Mitigation by cause:**

| Cause | Signature | Action |
|---|---|---|
| Rate limit tripped | `http_requests_total{status="429"}` spiking | Check if a specific user/IP is hammering. If legitimate, raise limit in `core/rate_limit.py`. If attack, block IP at nginx. |
| DB write bottleneck | `db_pool_checkedout` near pool max; slow INSERT logs | Kill long-running queries: `SHOW PROCESSLIST;`. If sustained, add read replicas (posts remain single-primary). |
| Redis down → idempotency fails | breaker open on redis; `IDEMPOTENCY_*` errors | Restart Redis. Idempotency DB is independent (MySQL) — should still work. |
| Disk full | `DiskSpaceLow` alert; `ENOSPC` in logs | See [§7](#7-disk-space-low). |
| Deploy rollback needed | Error rate spiked immediately after deploy | `docker compose -f docker-compose.prod.yml up -d --no-build` after tagging previous image as `:prod`. |

**Post-mortem hooks:**
- Top 3 error codes and their endpoints.
- Any error correlated with a specific user_id (targeted attack?) or a specific shard/connection?

---

## 3. Circuit breaker open (Redis degraded)

**Symptom:** `CircuitBreakerOpen{name="redis"}` alert. `/health/circuit-breakers` shows `state: "open"`.

**Diagnosis:**

```bash
# Get current breaker states (admin token required)
TOKEN=...
curl -sS -H "Authorization: Bearer $TOKEN" \
    http://localhost/health/circuit-breakers | jq .

# Direct Redis health
docker compose -f docker-compose.prod.yml exec redis redis-cli ping

# Redis memory + persistence
docker compose -f docker-compose.prod.yml exec redis redis-cli INFO memory
docker compose -f docker-compose.prod.yml exec redis redis-cli INFO persistence
```

**Mitigation:**

- **Redis unreachable** → restart Redis container. App auto-recovers: breaker transitions OPEN → HALF_OPEN after `recovery_timeout` (30s), one probe succeeds, breaker closes.
- **Redis reachable but slow** → check for a hot key (`MONITOR` for 5s). Large `feed:home:*` ZSETs are common hot keys.
- **Redis memory full** → check `maxmemory-policy` (should be `allkeys-lru` in prod); if `used_memory` near `maxmemory`, kill big keys (`--bigkeys`).

```bash
# Verify breaker closes after restart
sleep 35
curl -sS http://localhost/metrics | grep circuit_breaker_state
# circuit_breaker_state{name="redis"} 0.0   # closed
```

**Behavior during OPEN (degraded but functional):**
- Feed cache: DB fallback — slower, but correct.
- Rate limit: fails open (allows all traffic). Restore Redis promptly to avoid abuse.
- Presence: shows offline for all users.
- WS notifications: dropped (log only). Next reconnect pulls fresh inbox.
- Idempotency: still works (DB-backed).

**Post-mortem hooks:**
- How long was the breaker open?
- Did any data get lost silently (notifications dropped)? Cross-check with inbox count.

---

## 4. Celery backlog

**Symptom:** `CeleryQueueBacklog` alert (`celery_queue_depth > 1000` for 10m). Fanout lags; followers don't see new posts within seconds.

**Diagnosis:**

```bash
# Queue depth (same metric the alert uses)
curl -sS http://localhost/metrics | grep celery_queue_depth

# Worker activity
docker compose -f docker-compose.prod.yml logs --tail=100 worker | grep -i "fanout\|succeeded\|failed"

# Celery inspect (from inside worker container)
docker compose -f docker-compose.prod.yml exec worker \
    celery -A social_api.workers.celery_app inspect active
docker compose -f docker-compose.prod.yml exec worker \
    celery -A social_api.workers.celery_app inspect stats
```

**Mitigation:**

| Cause | Action |
|---|---|
| Worker crashed / stuck | Restart: `docker compose -f docker-compose.prod.yml restart worker`. Tasks are idempotent — safe to re-run. |
| Too many posts to fan out (celebrity + normal) | Scale workers: `CELERY_CONCURRENCY=8` in `.env.prod`, then `docker compose up -d worker`. |
| Poison task (always fails, blocks queue) | Check `task_failure` logs. If it's a specific post, temporarily mark it processed; investigate offline. |
| Retention/trending jobs hogging the worker | Move retention to a separate queue: `celery -Q retention` on a dedicated worker. |

**Post-mortem hooks:**
- Average queue depth over the incident window.
- Total delay for the slowest-tolerated task type (fanout target: < 5s).
- Should we raise `worker_concurrency` permanently?

---

## 5. WebSocket disconnects spike

**Symptom:** `WebSocketDropSpike` alert (`rate(websocket_disconnect_total{reason="error"}[5m]) > 10`).

**Diagnosis:**

```bash
# Disconnect reasons breakdown
curl -sS http://localhost/metrics | grep 'websocket_disconnect_total'

# Current active connections (per worker)
curl -sS http://localhost/metrics | grep websocket_connections_active

# Recent WS-related logs
docker compose -f docker-compose.prod.yml logs --tail=200 api | grep -i "ws_"
```

**Mitigation by reason:**

| Reason | Cause | Fix |
|---|---|---|
| `error` | Server-side exception in WS handler | Check `api` logs for traceback at the matching `user_id`. Likely a DB error mid-loop. |
| `timeout` | Client stopped sending heartbeat (30s reader timeout, 60s read timeout) | Client bug or network — acceptable. Monitor only if rate is high. |
| `client` | Client closed cleanly (app background, tab closed) | Normal churn. Only alert if abnormally high. |
| `server_shutdown` | Graceful deploy | Expected on deploy. Correlate with image update timestamp. |

**Post-mortem hooks:**
- Reason distribution during the spike (all `error`? all `timeout`?).
- Did a specific user account for most disconnects? (bad actor or broken client)
- Nginx `proxy_read_timeout` — is it long enough for WS connections with heartbeat? Currently 3600s.

---

## 6. DB connection pool exhausted

**Symptom:** `DBPoolExhausted` alert. `db_pool_checkedout` >= 20 (max_overflow). Write latency spikes; some requests time out.

**Diagnosis:**

```bash
curl -sS http://localhost/metrics | grep db_pool_

# Active MySQL connections
docker compose -f docker-compose.prod.yml exec mysql \
    mysql -usocial -p"$MYSQL_PASSWORD" -e "SHOW STATUS LIKE 'Threads_connected';"

# Slow queries
docker compose -f docker-compose.prod.yml exec mysql \
    mysql -usocial -p"$MYSQL_PASSWORD" -e "SHOW FULL PROCESSLIST;" | head -20

# Slow query log (if enabled)
docker compose -f docker-compose.prod.yml exec mysql \
    tail -100 /var/log/mysql/slow.log
```

**Mitigation:**

| Cause | Action |
|---|---|
| Long-running query (e.g., missing index) | `KILL <id>;` for the offender; add the missing index in a new Alembic migration. |
| Query pattern regression | Recent deploy? Roll back. Check EXPLAIN on the new query. |
| Legitimate traffic spike | Scale API workers up (`GUNICORN_WORKERS=8`), but MySQL max_connections must cover it. |
| Connection leak in code | Check `db_pool_checkedout` doesn't reset after traffic subsides. If it stays high → leak. File a bug; add `try/finally` around the session. |

**Post-mortem hooks:**
- Top 5 slow queries with `EXPLAIN`.
- Were new indexes needed? (Add in next deploy.)
- Did we need bigger `max_connections` (default 151) or sharded pools?

---

## 7. Disk space low

**Symptom:** `DiskSpaceLow` alert (< 15% on `/data`). Media uploads may fail with `ENOSPC`.

**Diagnosis:**

```bash
docker compose -f docker-compose.prod.yml exec api df -h /app/data
docker compose -f docker-compose.prod.yml exec api du -sh /app/data/*

# Which users own the biggest media?
ls -la /app/data/media | awk '{print $5, $9}' | sort -rn | head -20
```

**Mitigation:**

| Cause | Action |
|---|---|
| Media growth (normal) | Run `purge_orphan_media` task (M19) — deletes unattached media older than 30d. Also: shrink video upload limit if not needed. |
| Soft-deleted users' data piling up | Run `purge_soft_deleted_users` — deletes users past 30d window. |
| Log files (structured JSON logs) | Rotate: `docker compose logs` is ephemeral; if using a volume, ensure logrotate. |
| DB binary logs (MySQL) | `PURGE BINARY LOGS BEFORE DATE_SUB(NOW(), INTERVAL 7 DAY);` |
| Backup snapshots | Rotate old backups per retention policy. |

**Emergency (free space now):**
```bash
# Delete unverified/viral media older than 7 days
docker compose -f docker-compose.prod.yml exec api \
    python -c "
import asyncio
from social_api.workers.tasks.retention import _do_purge_orphan_media
print(asyncio.run(_do_purge_orphan_media()))
"
```

**Post-mortem hooks:**
- Growth rate of `/data` over the past week.
- Are we tracking media tier? (Local FS → S3 migration removes this concern.)
- Backup retention policy — too long?

---

## Alert → runbook index

| Alert | Runbook section |
|---|---|
| `HighErrorRate` | §2 |
| `HighLatencyGlobal`, `HighLatencyFeed` | §2 (start with DB pool §6) |
| `CircuitBreakerOpen{name="redis"}` | §3 |
| `CeleryQueueBacklog` | §4 |
| `WebSocketDropSpike` | §5 |
| `DBPoolExhausted` | §6 |
| `DiskSpaceLow` | §7 |

## Escalation

For anything not covered:
1. `docker compose -f docker-compose.prod.yml ps` — sanity check all containers.
2. `curl http://localhost/health/ready` — which dep is down.
3. `curl http://localhost/metrics` — scrape and diff against baseline.
4. `docker compose logs --tail=500 api worker beat` — full tail.
5. Ask in `#social-api-ops` if applicable.
