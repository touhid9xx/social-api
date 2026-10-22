# Social API — API Reference

Version: `0.1.0`

Base URL: `/`

---

## Endpoints

### `GET` /health

**Summary:** Liveness probe

**Tags:** health

**operationId:** `health_health_get`


**Responses:**

- `200` — Successful Response

---

### `GET` /health/db

**Summary:** Database readiness probe

**Tags:** health

**operationId:** `health_db_health_db_get`


**Responses:**

- `200` — Successful Response

---

### `GET` /health/ready

**Summary:** Readiness probe (aggregate)

**Tags:** health

**operationId:** `readiness_health_ready_get`


**Responses:**

- `200` — Successful Response

---

### `GET` /health/redis

**Summary:** Redis readiness probe

**Tags:** health

**operationId:** `health_redis_health_redis_get`


**Responses:**

- `200` — Successful Response

---
